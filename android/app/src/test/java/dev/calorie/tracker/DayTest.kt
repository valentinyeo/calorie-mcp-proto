package dev.calorie.tracker

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class DayTest {
    private fun json(date: String = "2026-11-11", zone: String = "Europe/London") = JSONObject()
        .put("date", date).put("timezone", zone).put("consumed_kcal", 1240).put("goal_kcal", 2100)
        .put("remaining_kcal", 860).put("protein_g", 62).put("carbs_g", 148).put("fat_g", 41)
        .put("entries", JSONArray())
    private fun row(id: Long, time: String, source: String = "mcp", client: String = "claude-code") = JSONObject()
        .put("id", id).put("name", "Porridge").put("kcal", 310).put("portion_text", JSONObject.NULL)
        .put("eaten_at", time).put("source", source).put("client_name", client)

    @Test fun todayUsesProfileTimezoneNotDeviceOrUtc() {
        val now = Instant.parse("2026-11-11T23:30:00Z")
        assertTrue(Day.parse(json("2026-11-12", "Pacific/Kiritimati")).isToday(now))
        assertFalse(Day.parse(json("2026-11-11", "Pacific/Kiritimati")).isToday(now))
    }
    @Test fun oldCacheExpiresAtLocalMidnight() {
        val day = Day.parse(json())
        assertTrue(day.isToday(Instant.parse("2026-11-11T23:59:59Z")))
        assertFalse(day.isToday(Instant.parse("2026-11-12T00:00:00Z")))
    }
    @Test fun daylightSavingTransitionDoesNotChangeTheDay() {
        val day = Day.parse(json("2026-10-25", "Europe/London"))
        assertTrue(day.isToday(Instant.parse("2026-10-25T00:30:00Z")))
        assertTrue(day.isToday(Instant.parse("2026-10-25T01:30:00Z")))
    }
    @Test fun entriesNewestFirstWithStableIdTiebreak() {
        val data = json().put("entries", JSONArray()
            .put(row(1, "2026-11-11T07:40:00Z")).put(row(2, "2026-11-11T17:40:00Z"))
            .put(row(3, "2026-11-11T17:40:00Z")))
        assertEquals(listOf(3L, 2L, 1L), Day.parse(data).entries.map { it.id })
    }
    @Test fun sourceAndNullablePortionAreReadable() {
        val data = json().put("entries", JSONArray().put(row(1, "2026-11-11T07:40:00Z")))
        val food = Day.parse(data).entries.single()
        assertEquals("Added from Claude", food.sourceLabel)
        assertEquals("", food.portion)
        assertEquals("Added from ChatGPT", food.copy(client = "ChatGPT").sourceLabel)
        assertEquals("Added in app", food.copy(source = "app").sourceLabel)
    }
    @Test fun summaryUsesServerTotalsIncludingOverGoal() {
        val day = Day.parse(json().put("consumed_kcal", 2200).put("remaining_kcal", -100))
        assertEquals(2200, day.consumed)
        assertEquals(2100, day.goal)
        assertEquals(-100, day.left)
    }
}
