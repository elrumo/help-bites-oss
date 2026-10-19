export function endUserDisplayName(endUser: ParseObject, claims?: { name?: string, sub?: string }): string {
  return String(endUser.get('name') || claims?.name || endUser.get('email') || endUser.get('externalId') || claims?.sub || 'User').slice(0, 120)
}

/** Replies are signed with the project's from-name so every project keeps its own voice. */
export function agentDisplayName(project: ParseObject, agent: ParseObject): string {
  return String(project.get('fromName') || agent.get('name') || agent.get('username') || 'Support').slice(0, 120)
}
