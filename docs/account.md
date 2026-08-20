# Account

## Email confirmation recovery

Password accounts must confirm their email before signing in. When a user submits the correct
password for an unconfirmed account, the API keeps an existing valid confirmation link or issues
and emails a replacement when that link has expired. The sign-in form warns the user which action
was taken.

Forgot-password requests for unconfirmed accounts do not create password-reset tokens. They follow
the same confirmation-link recovery behavior and show a warning that email confirmation is required
before a password can be reset.

## Password changes

Authenticated users can change their password from the account page by providing their current
password and a matching new password of 8–128 characters. The new password must differ from the
current password.

Changing a password rotates the account session key, revokes existing sessions and pending account
action tokens, and issues a replacement session token to the device that submitted the change.
