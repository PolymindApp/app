package dev.coulombe.mom

import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContract
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val readStepsPermission = HealthPermission.getReadPermission(StepsRecord::class)
    private val permissionContract: ActivityResultContract<Set<String>, Set<String>> =
        PermissionController.createRequestPermissionResultContract()

    @PluginMethod
    fun getStatus(call: PluginCall) {
        when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_AVAILABLE -> scope.launch {
                try {
                    val authorized = healthClient()
                        .permissionController
                        .getGrantedPermissions()
                        .contains(readStepsPermission)
                    call.resolve(statusResult("available", authorized))
                } catch (exception: Exception) {
                    call.reject(
                        healthErrorMessage(exception),
                        "HEALTH_CONNECT_READ_FAILED",
                        exception,
                    )
                }
            }
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ->
                call.resolve(statusResult("update_required", false))
            else -> call.resolve(statusResult("unavailable", false))
        }
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                call.reject(
                    "Health Connect must be installed or updated.",
                    "HEALTH_CONNECT_UPDATE_REQUIRED",
                )
                return
            }
            HealthConnectClient.SDK_UNAVAILABLE -> {
                call.reject(
                    "Health Connect is not available on this device.",
                    "HEALTH_CONNECT_UNAVAILABLE",
                )
                return
            }
        }

        val intent = permissionContract.createIntent(context, setOf(readStepsPermission))
        startActivityForResult(call, intent, "permissionResult")
    }

    @ActivityCallback
    private fun permissionResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val granted = permissionContract.parseResult(result.resultCode, result.data)
        call.resolve(JSObject().put("authorized", granted.contains(readStepsPermission)))
    }

    @PluginMethod
    fun readSteps(call: PluginCall) {
        val startTime = parseInstant(call, "startTime") ?: return
        val endTime = parseInstant(call, "endTime") ?: return
        if (!endTime.isAfter(startTime)) {
            call.reject("The step time range is invalid.", "HEALTH_CONNECT_INVALID_RANGE")
            return
        }

        when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                call.reject(
                    "Health Connect must be installed or updated.",
                    "HEALTH_CONNECT_UPDATE_REQUIRED",
                )
                return
            }
            HealthConnectClient.SDK_UNAVAILABLE -> {
                call.reject(
                    "Health Connect is not available on this device.",
                    "HEALTH_CONNECT_UNAVAILABLE",
                )
                return
            }
        }

        scope.launch {
            try {
                val client = healthClient()
                val granted = client.permissionController.getGrantedPermissions()
                if (!granted.contains(readStepsPermission)) {
                    call.reject(
                        "Allow Polymind to read steps in Health Connect.",
                        "HEALTH_CONNECT_PERMISSION_REQUIRED",
                    )
                    return@launch
                }

                val response = client.aggregate(
                    AggregateRequest(
                        metrics = setOf(StepsRecord.COUNT_TOTAL),
                        timeRangeFilter = TimeRangeFilter.between(startTime, endTime),
                    ),
                )
                val steps = response[StepsRecord.COUNT_TOTAL] ?: 0L
                call.resolve(JSObject().put("steps", steps))
            } catch (exception: SecurityException) {
                call.reject(
                    "Allow Polymind to read steps in Health Connect.",
                    "HEALTH_CONNECT_PERMISSION_REQUIRED",
                    exception,
                )
            } catch (exception: Exception) {
                call.reject(
                    healthErrorMessage(exception),
                    "HEALTH_CONNECT_READ_FAILED",
                    exception,
                )
            }
        }
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (exception: Exception) {
            call.reject(
                "Health Connect settings could not be opened.",
                "HEALTH_CONNECT_UNAVAILABLE",
                exception,
            )
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    private fun healthClient() = HealthConnectClient.getOrCreate(context)

    private fun parseInstant(call: PluginCall, field: String): Instant? {
        val value = call.getString(field)
        if (value.isNullOrBlank()) {
            call.reject("The $field value is required.", "HEALTH_CONNECT_INVALID_RANGE")
            return null
        }
        return try {
            Instant.parse(value)
        } catch (exception: Exception) {
            call.reject(
                "The $field value is invalid.",
                "HEALTH_CONNECT_INVALID_RANGE",
                exception,
            )
            null
        }
    }

    private fun statusResult(availability: String, authorized: Boolean) = JSObject().apply {
        put("availability", availability)
        put("authorized", authorized)
    }

    private fun healthErrorMessage(exception: Exception): String =
        exception.message?.takeIf { it.isNotBlank() }
            ?: "Polymind could not communicate with Health Connect."
}
