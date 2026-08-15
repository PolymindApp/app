package app.backontrack.android;

import android.os.Build;
import android.os.CancellationSignal;

import androidx.core.content.ContextCompat;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CreatePublicKeyCredentialResponse;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPublicKeyCredentialOption;
import androidx.credentials.PublicKeyCredential;
import androidx.credentials.exceptions.CreateCredentialCancellationException;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "Passkey")
public class PasskeyPlugin extends Plugin {

    private final AtomicBoolean busy = new AtomicBoolean(false);
    private CredentialManager credentialManager;

    @Override
    public void load() {
        credentialManager = CredentialManager.create(getContext());
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P);
        call.resolve(result);
    }

    @PluginMethod
    public void createCredential(PluginCall call) {
        if (!begin(call)) {
            return;
        }

        String requestJson = call.getString("requestJson");
        if (requestJson == null || requestJson.isBlank()) {
            finishWithError(call, "The passkey registration request is missing.", "PASSKEY_INVALID_REQUEST");
            return;
        }

        final CreatePublicKeyCredentialRequest request;
        try {
            request = new CreatePublicKeyCredentialRequest(requestJson);
        } catch (IllegalArgumentException exception) {
            finishWithError(call, "The passkey registration request is invalid.", "PASSKEY_INVALID_REQUEST", exception);
            return;
        }

        credentialManager.createCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                @Override
                public void onResult(CreateCredentialResponse response) {
                    busy.set(false);
                    if (!(response instanceof CreatePublicKeyCredentialResponse)) {
                        call.reject("The credential provider returned an unsupported response.", "PASSKEY_UNSUPPORTED_RESPONSE");
                        return;
                    }

                    JSObject result = new JSObject();
                    result.put(
                        "responseJson",
                        ((CreatePublicKeyCredentialResponse) response).getRegistrationResponseJson()
                    );
                    call.resolve(result);
                }

                @Override
                public void onError(CreateCredentialException exception) {
                    if (exception instanceof CreateCredentialCancellationException) {
                        finishWithError(call, "Passkey creation was cancelled.", "PASSKEY_CANCELLED", exception);
                    } else {
                        finishWithError(call, credentialErrorMessage(exception), "PASSKEY_CREATE_FAILED", exception);
                    }
                }
            }
        );
    }

    @PluginMethod
    public void getCredential(PluginCall call) {
        if (!begin(call)) {
            return;
        }

        String requestJson = call.getString("requestJson");
        if (requestJson == null || requestJson.isBlank()) {
            finishWithError(call, "The passkey sign-in request is missing.", "PASSKEY_INVALID_REQUEST");
            return;
        }

        final GetCredentialRequest request;
        try {
            GetPublicKeyCredentialOption option = new GetPublicKeyCredentialOption(requestJson);
            request = new GetCredentialRequest.Builder()
                .addCredentialOption(option)
                .build();
        } catch (IllegalArgumentException exception) {
            finishWithError(call, "The passkey sign-in request is invalid.", "PASSKEY_INVALID_REQUEST", exception);
            return;
        }

        credentialManager.getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    busy.set(false);
                    Credential credential = response.getCredential();
                    if (!(credential instanceof PublicKeyCredential)) {
                        call.reject("The credential provider returned an unsupported response.", "PASSKEY_UNSUPPORTED_RESPONSE");
                        return;
                    }

                    JSObject result = new JSObject();
                    result.put(
                        "responseJson",
                        ((PublicKeyCredential) credential).getAuthenticationResponseJson()
                    );
                    call.resolve(result);
                }

                @Override
                public void onError(GetCredentialException exception) {
                    if (exception instanceof GetCredentialCancellationException) {
                        finishWithError(call, "Passkey sign-in was cancelled.", "PASSKEY_CANCELLED", exception);
                    } else {
                        finishWithError(call, credentialErrorMessage(exception), "PASSKEY_GET_FAILED", exception);
                    }
                }
            }
        );
    }

    private boolean begin(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            call.reject("Passkeys require Android 9 or newer.", "PASSKEY_UNAVAILABLE");
            return false;
        }
        if (getActivity() == null) {
            call.reject("The Android activity is not available.", "PASSKEY_UNAVAILABLE");
            return false;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("Another passkey request is already open.", "PASSKEY_BUSY");
            return false;
        }
        return true;
    }

    private String credentialErrorMessage(Exception exception) {
        String message = exception.getMessage();
        if (message == null || message.isBlank()) {
            return "The Android credential provider could not complete this passkey request.";
        }
        return message;
    }

    private void finishWithError(PluginCall call, String message, String code) {
        busy.set(false);
        call.reject(message, code);
    }

    private void finishWithError(PluginCall call, String message, String code, Exception exception) {
        busy.set(false);
        call.reject(message, code, exception);
    }
}
