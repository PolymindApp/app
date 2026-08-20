# Account

## Password changes

Authenticated users can change their password from the account page by providing their current
password and a matching new password of 8–128 characters. The new password must differ from the
current password.

Changing a password rotates the account session key, revokes existing sessions and pending account
action tokens, and issues a replacement session token to the device that submitted the change.
