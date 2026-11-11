package dev.calorie.tracker

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class Vault(context: Context) {
    private val prefs = context.getSharedPreferences("account", Context.MODE_PRIVATE)
    private val key: SecretKey by lazy {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("calorie-account", null) as? SecretKey) ?: KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore",
        ).apply {
            init(KeyGenParameterSpec.Builder("calorie-account", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun read(name: String): String? = prefs.getString(name, null)?.let { encoded ->
        runCatching {
            val bytes = Base64.decode(encoded, Base64.NO_WRAP)
            Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            }.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8)
        }.getOrNull()
    }
    fun write(name: String, value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
        check(prefs.edit().putString(name, Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)).commit())
    }
    fun remove(name: String) { check(prefs.edit().remove(name).commit()) }
    fun clear() { check(prefs.edit().clear().commit()) }
}
