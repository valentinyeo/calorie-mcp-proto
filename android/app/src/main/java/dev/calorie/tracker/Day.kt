package dev.calorie.tracker

import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

data class Food(
    val id: Long, val name: String, val kcal: Int, val portion: String,
    val eatenAt: Instant, val source: String, val client: String,
) {
    val sourceLabel: String get() = when (source) {
        "mcp" -> "Added from ${when {
            client.contains("claude", true) -> "Claude"
            client.contains("chatgpt", true) -> "ChatGPT"
            client.isNotBlank() -> client
            else -> "AI chat"
        }}"
        "app" -> "Added in app"
        else -> "Added from $source"
    }
}

data class Day(
    val date: String, val timezone: String, val consumed: Int, val goal: Int, val left: Int,
    val protein: Double, val carbs: Double, val fat: Double, val entries: List<Food>,
) {
    fun isToday(now: Instant = Instant.now()): Boolean =
        date == now.atZone(ZoneId.of(timezone)).toLocalDate().toString()

    companion object {
        fun parse(json: JSONObject): Day {
            val rows = json.getJSONArray("entries")
            return Day(
                json.getString("date"), json.getString("timezone"),
                json.getInt("consumed_kcal"), json.getInt("goal_kcal"), json.getInt("remaining_kcal"),
                json.getDouble("protein_g"), json.getDouble("carbs_g"), json.getDouble("fat_g"),
                List(rows.length()) { index ->
                    val entry = rows.getJSONObject(index)
                    Food(entry.getLong("id"), entry.getString("name"), entry.getInt("kcal"),
                        if (entry.isNull("portion_text")) "" else entry.getString("portion_text"),
                        Instant.parse(entry.getString("eaten_at")), entry.getString("source"),
                        if (entry.isNull("client_name")) "" else entry.getString("client_name"))
                }.sortedWith(compareByDescending<Food> { it.eatenAt }.thenByDescending { it.id }),
            ).also { ZoneId.of(it.timezone) }
        }
    }
}
