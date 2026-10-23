// A project's settings open as a modal over whatever page you are on
// (SettingsProjectModal, mounted by the default layout). `section` is one of
// the settings page's anchors (company, widget, …) to scroll to.
export function useProjectSettings() {
  const target = useState<{ id: string, section?: string } | null>('project-settings', () => null)
  return { target, openProjectSettings: (id: string, section?: string) => { target.value = { id, section } } }
}
