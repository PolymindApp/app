export interface AuthActionResponse {
  message: string
  email?: string
  action?: 'password_reset' | 'email_verification'
}
