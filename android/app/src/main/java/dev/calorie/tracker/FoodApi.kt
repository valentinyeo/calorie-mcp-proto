package dev.calorie.tracker

import android.net.Uri
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom

class ApiFailure(val status: Int) : Exception("Request failed")

class FoodApi(private val vault: Vault) {
    private val origin = BuildConfig.ORIGIN
    private val resource = "$origin/mcp"
    private val redirect = "dev.calorie.tracker://oauth/callback"
    val signedIn: Boolean get() = vault.read("tokens") != null
    fun cachedDay(): Day? = runCatching {
        if (!signedIn) null else vault.read("day")?.let { Day.parse(JSONObject(it)) }?.takeIf { it.isToday() }
    }.getOrNull()

    private fun request(path: String, method: String, body: String? = null, token: String? = null,
                        contentType: String = "application/json"): JSONObject {
        val connection = URI(origin + path).toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.setRequestProperty("Content-Type", contentType)
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toByteArray()) }
            }
            if (connection.responseCode !in 200..299) throw ApiFailure(connection.responseCode)
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
    private fun form(values: Map<String, String>): String = values.entries.joinToString("&") {
        "${URLEncoder.encode(it.key, "UTF-8")}=${URLEncoder.encode(it.value, "UTF-8")}"
    }
    private fun random(): String = Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    fun beginLogin(): Uri {
        val client = request("/oauth2/register", "POST", JSONObject()
            .put("client_name", "Calorie Tracker Android")
            .put("redirect_uris", org.json.JSONArray().put(redirect))
            .put("token_endpoint_auth_method", "none")
            .put("grant_types", org.json.JSONArray().put("authorization_code").put("refresh_token"))
            .put("response_types", org.json.JSONArray().put("code"))
            .put("application_type", "native").toString()).getString("client_id")
        val verifier = random()
        val state = random()
        vault.write("pending", JSONObject().put("client", client).put("verifier", verifier)
            .put("state", state).put("created", System.currentTimeMillis()).toString())
        val challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()),
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        return Uri.parse("$origin/oauth2/authorize?" + form(mapOf("client_id" to client, "redirect_uri" to redirect,
            "response_type" to "code", "scope" to "mcp:read mcp:write offline_access", "state" to state,
            "code_challenge" to challenge, "code_challenge_method" to "S256", "resource" to resource)))
    }
    fun finishLogin(uri: Uri) {
        require(uri.scheme == "dev.calorie.tracker" && uri.host == "oauth" && uri.path == "/callback")
        val pending = JSONObject(vault.read("pending") ?: error("Sign in again"))
        require(uri.getQueryParameter("state") == pending.getString("state"))
        require(System.currentTimeMillis() - pending.getLong("created") in 0..600000)
        val code = uri.getQueryParameter("code") ?: error("Sign in cancelled")
        vault.remove("pending")
        val tokens = request("/oauth2/token", "POST", form(mapOf("grant_type" to "authorization_code",
            "code" to code, "redirect_uri" to redirect, "client_id" to pending.getString("client"),
            "code_verifier" to pending.getString("verifier"), "resource" to resource)), contentType = "application/x-www-form-urlencoded")
        tokens.put("client", pending.getString("client"))
        vault.remove("day")
        saveTokens(tokens)
    }
    private fun saveTokens(tokens: JSONObject) {
        require(tokens.getString("access_token").isNotBlank())
        tokens.put("expires_at", System.currentTimeMillis() + tokens.getLong("expires_in") * 1000)
        vault.write("tokens", tokens.toString())
    }
    private fun accessToken(): String {
        var tokens = JSONObject(vault.read("tokens") ?: throw ApiFailure(401))
        if (System.currentTimeMillis() + 60000 >= tokens.getLong("expires_at")) {
            val next = try {
                request("/oauth2/token", "POST", form(mapOf("grant_type" to "refresh_token",
                    "refresh_token" to tokens.getString("refresh_token"), "client_id" to tokens.getString("client"),
                    "resource" to resource)), contentType = "application/x-www-form-urlencoded")
            } catch (failure: ApiFailure) {
                if (failure.status in listOf(400, 401)) throw ApiFailure(401)
                throw failure
            }
            next.put("client", tokens.getString("client"))
            if (!next.has("refresh_token")) next.put("refresh_token", tokens.getString("refresh_token"))
            saveTokens(next)
            tokens = next
        }
        return tokens.getString("access_token")
    }
    fun day(): Day = cache(request("/api/app/day", "GET", token = accessToken()))
    fun save(food: Food?, name: String, kcal: Int, portion: String): Day {
        val path = "/api/app/entries" + (food?.let { "/${it.id}" } ?: "")
        return cache(request(path, if (food == null) "POST" else "PATCH", JSONObject().put("name", name)
            .put("kcal", kcal).put("portion_text", portion).toString(), accessToken()).getJSONObject("day"))
    }
    fun delete(id: Long): Day = cache(request("/api/app/entries/$id", "DELETE", token = accessToken()).getJSONObject("day"))
    fun restore(id: Long): Day = cache(request("/api/app/entries/$id/restore", "POST", "{}", accessToken()).getJSONObject("day"))
    private fun cache(json: JSONObject): Day = Day.parse(json).also { vault.write("day", json.toString()) }
    fun signOut() { vault.clear() }
}
