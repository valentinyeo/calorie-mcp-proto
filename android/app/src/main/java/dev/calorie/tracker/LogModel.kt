package dev.calorie.tracker

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class LogModel(application: Application) : AndroidViewModel(application) {
    private val api = FoodApi(Vault(application))
    private val mutableDay = MutableStateFlow(api.cachedDay())
    val day = mutableDay.asStateFlow()
    private val mutableSignedIn = MutableStateFlow(api.signedIn)
    val signedIn = mutableSignedIn.asStateFlow()
    val busy = MutableStateFlow(false)
    val error = MutableStateFlow<String?>(null)

    private fun action(work: suspend () -> Unit) {
        if (busy.value) return
        busy.value = true
        error.value = null
        viewModelScope.launch {
            try { work() }
            catch (cancel: CancellationException) { throw cancel }
            catch (failure: Exception) {
                if (failure is ApiFailure && failure.status == 401) {
                    withContext(Dispatchers.IO) { api.signOut() }
                    mutableSignedIn.value = false
                    mutableDay.value = null
                    error.value = "Sign in again"
                } else error.value = "Could not save or refresh. Try again."
            } finally { busy.value = false }
        }
    }
    fun expireDay() {
        if (mutableDay.value?.isToday() == false) mutableDay.value = null
    }
    fun refresh() {
        expireDay()
        if (!mutableSignedIn.value) return
        action { mutableDay.value = withContext(Dispatchers.IO) { api.day() } }
    }
    fun login(open: (Uri) -> Unit) = action {
        val uri = withContext(Dispatchers.IO) { api.beginLogin() }
        open(uri)
    }
    fun callback(uri: Uri) = action {
        withContext(Dispatchers.IO) { api.finishLogin(uri) }
        mutableDay.value = null
        mutableSignedIn.value = true
        mutableDay.value = withContext(Dispatchers.IO) { api.day() }
    }
    fun save(food: Food?, name: String, kcal: Int, portion: String, done: () -> Unit) = action {
        mutableDay.value = withContext(Dispatchers.IO) { api.save(food, name, kcal, portion) }
        done()
    }
    fun delete(food: Food, done: () -> Unit) = action {
        mutableDay.value = withContext(Dispatchers.IO) { api.delete(food.id) }
        done()
    }
    fun undo(food: Food) = action {
        mutableDay.value = withContext(Dispatchers.IO) { api.restore(food.id) }
    }
    fun signOut() = action {
        withContext(Dispatchers.IO) { api.signOut() }
        mutableDay.value = null
        mutableSignedIn.value = false
    }
}
