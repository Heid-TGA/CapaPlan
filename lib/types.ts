export type UserRole = 'TL' | 'PL'

export interface AppUser {
  id: string
  name: string
  role: UserRole
}
