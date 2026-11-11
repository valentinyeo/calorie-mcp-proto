package dev.calorie.tracker

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val Background = Color(0xFFFAFDF8)
private val Surface = Color(0xFFF0F4EE)
private val Green = Color(0xFF2F6F4F)
private val Ink = Color(0xFF191C19)

class MainActivity : ComponentActivity() {
    private val model: LogModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        intent.data?.let { model.callback(it); intent.data = null }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                var seconds = 0
                while (true) {
                    model.expireDay()
                    if (seconds++ % 30 == 0) model.refresh()
                    delay(1000)
                }
            }
        }
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Green, background = Background,
                surface = Background, surfaceVariant = Surface, onSurface = Ink, onBackground = Ink)) {
                Home(model) { uri -> CustomTabsIntent.Builder().build().launchUrl(this, uri) }
            }
        }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { model.callback(it); intent.data = null }
    }
}

@Composable
private fun Home(model: LogModel, open: (android.net.Uri) -> Unit) {
    val day by model.day.collectAsStateWithLifecycle()
    val signedIn by model.signedIn.collectAsStateWithLifecycle()
    val busy by model.busy.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Food?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(signedIn) {
        if (!signedIn) { adding = false; editing = null }
    }
    val today = day?.date?.let(LocalDate::parse) ?: LocalDate.now()
    Scaffold(
        containerColor = Background,
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            if (signedIn) SmallFloatingActionButton(onClick = { adding = true }, containerColor = Green,
                contentColor = Color.White, shape = RoundedCornerShape(12.dp)) { Text("+", fontSize = 28.sp) }
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).padding(horizontal = 24.dp),
            contentPadding = PaddingValues(bottom = 90.dp)) {
            item {
                Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Today, ${today.format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.UK))}",
                        modifier = Modifier.weight(1f), fontSize = 14.sp)
                    if (signedIn) TextButton(onClick = model::signOut, enabled = !busy) { Text("Sign out") }
                }
            }
            if (!signedIn) {
                item {
                    Text("Calories eaten today", Modifier.padding(top = 24.dp), fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
                    Button(onClick = { model.login(open) }, enabled = !busy, modifier = Modifier.padding(top = 24.dp)) { Text("Sign in") }
                }
            } else {
                item {
                    if (day != null) Summary(requireNotNull(day))
                    else Text(if (busy) "Loading today…" else "Today is unavailable", Modifier.padding(vertical = 24.dp))
                }
                item {
                    Row(Modifier.fillMaxWidth().padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Today's entries", Modifier.weight(1f), color = Green, fontSize = 14.sp)
                        Text("${day?.entries?.size ?: 0} entries", fontSize = 12.sp)
                        TextButton(onClick = model::refresh, enabled = !busy) { Text("Refresh") }
                    }
                    if (day != null && day?.entries?.isEmpty() == true) Text("No food logged today", Modifier.padding(vertical = 16.dp))
                }
                items(day?.entries.orEmpty(), key = { it.id }) { food ->
                    FoodRow(food, day?.timezone ?: "UTC", !busy, edit = { editing = food }, delete = {
                        model.delete(food) {
                            scope.launch {
                                snackbar.currentSnackbarData?.dismiss()
                                if (snackbar.showSnackbar("Entry deleted", "Undo", duration = SnackbarDuration.Long) == SnackbarResult.ActionPerformed) model.undo(food)
                            }
                        }
                    })
                }
            }
            item {
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 12.dp))
                if (error != null) Text(requireNotNull(error), Modifier.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.error)
            }
        }
    }
    if (adding || editing != null) FoodEditor(editing, busy,
        dismiss = { if (!busy) { adding = false; editing = null } },
        save = { name, kcal, portion -> model.save(editing, name, kcal, portion) { adding = false; editing = null } },
        delete = editing?.let { food -> { model.delete(food) {
            editing = null
            scope.launch {
                if (snackbar.showSnackbar("Entry deleted", "Undo", duration = SnackbarDuration.Long) == SnackbarResult.ActionPerformed) model.undo(food)
            }
        } } }, error = error)
}

@Composable
private fun Summary(day: Day) {
    Column(Modifier.fillMaxWidth().padding(top = 8.dp).background(Surface, RoundedCornerShape(28.dp)).padding(24.dp)) {
        Text("Calories eaten today", fontSize = 14.sp)
        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.Bottom) {
            Text(String.format(Locale.UK, "%,d", day.consumed), fontSize = 60.sp, lineHeight = 68.sp, fontWeight = FontWeight.Bold)
            Text(" kcal", Modifier.padding(bottom = 9.dp), fontSize = 18.sp)
        }
        Row(Modifier.fillMaxWidth().padding(top = 16.dp)) {
            Text("of ${String.format(Locale.UK, "%,d", day.goal)} kcal goal", Modifier.weight(1f))
            Text(if (day.left >= 0) "${day.left} left" else "${-day.left} over", color = Green, fontWeight = FontWeight.SemiBold)
        }
        LinearProgressIndicator(progress = { (day.consumed.toFloat() / day.goal.coerceAtLeast(1)).coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp), color = Green, trackColor = Color(0xFFE3E9E0))
        Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Protein ${day.protein.toInt()} g", fontSize = 12.sp)
            Text("Carbs ${day.carbs.toInt()} g", fontSize = 12.sp)
            Text("Fat ${day.fat.toInt()} g", fontSize = 12.sp)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FoodRow(food: Food, timezone: String, enabled: Boolean, edit: () -> Unit, delete: () -> Unit) {
    val dismiss = rememberSwipeToDismissBoxState(confirmValueChange = { value ->
        if (value == SwipeToDismissBoxValue.EndToStart && enabled) delete()
        false
    })
    SwipeToDismissBox(state = dismiss, enableDismissFromStartToEnd = false, enableDismissFromEndToStart = enabled,
        backgroundContent = { Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.errorContainer).padding(16.dp), contentAlignment = Alignment.CenterEnd) { Text("Delete") } }) {
        Row(Modifier.fillMaxWidth().background(Background).clickable(enabled = enabled, onClick = edit).padding(vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text(food.eatenAt.atZone(ZoneId.of(timezone)).format(DateTimeFormatter.ofPattern("HH:mm")),
                Modifier.width(52.dp), fontSize = 12.sp)
            Column(Modifier.weight(1f)) {
                Text(food.name, fontWeight = FontWeight.Medium)
                if (food.portion.isNotEmpty()) Text(food.portion, fontSize = 12.sp)
                Text(food.sourceLabel, fontSize = 12.sp, color = Green)
            }
            Text("${food.kcal} kcal", Modifier.padding(start = 8.dp), fontWeight = FontWeight.Medium)
        }
    }
    HorizontalDivider(color = Color(0xFFE3E9E0))
}

@Composable
private fun FoodEditor(food: Food?, busy: Boolean, dismiss: () -> Unit,
                       save: (String, Int, String) -> Unit, delete: (() -> Unit)?, error: String?) {
    var name by remember(food?.id) { mutableStateOf(food?.name.orEmpty()) }
    var kcal by remember(food?.id) { mutableStateOf(food?.kcal?.toString().orEmpty()) }
    var portion by remember(food?.id) { mutableStateOf(food?.portion.orEmpty()) }
    val valid = name.isNotBlank() && name.trim().length <= 200 && (kcal.toIntOrNull()?.let { it in 0..20000 } == true) && portion.length <= 120
    AlertDialog(onDismissRequest = dismiss,
        title = { Text(if (food == null) "Add food" else "Edit food") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(name, { name = it }, label = { Text("Food") }, enabled = !busy, singleLine = true)
            OutlinedTextField(kcal, { kcal = it }, label = { Text("Calories") }, enabled = !busy, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            OutlinedTextField(portion, { portion = it }, label = { Text("Portion") }, enabled = !busy, singleLine = true)
            if (delete != null) TextButton(onClick = delete, enabled = !busy) { Text("Delete entry") }
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
        } },
        confirmButton = { TextButton(onClick = { save(name.trim(), kcal.toInt(), portion) }, enabled = valid && !busy) { Text("Save") } },
        dismissButton = { TextButton(onClick = dismiss, enabled = !busy) { Text("Cancel") } })
}
