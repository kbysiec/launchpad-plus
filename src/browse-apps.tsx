import { Action, ActionPanel, Application, getApplications, List } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 10; // number of apps to show per scroll

export default function Command() {
  const [allApps, setAllApps] = useState<Application[]>([]);
  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // 🚀 Load apps once
  useEffect(() => {
    async function fetchApps() {
      const installedApps = await getApplications();
      installedApps.sort((a, b) => a.name.localeCompare(b.name));
      setAllApps(installedApps);
      setIsLoading(false);
    }
    fetchApps();
  }, []);

  // 🔍 Compute filtered list based on search text (always searches all apps)
  const filteredApps = useMemo(() => {
    if (!searchText) return allApps;
    const lower = searchText.toLowerCase();
    return allApps.filter((a) => a.name.toLowerCase().includes(lower));
  }, [allApps, searchText]);

  // 🧩 Slice to visible items for infinite scroll
  const visibleApps = filteredApps.slice(0, visibleCount);

  // 🧠 When scrolling near bottom, load more
  function handleSelectionChange(selectedId: string | null) {
    if (!selectedId) return;
    const index = visibleApps.findIndex((app) => app.path === selectedId);
    const nearEnd = index >= visibleApps.length - 10;
    if (nearEnd && visibleCount < filteredApps.length) {
      setVisibleCount((prev) => prev + PAGE_SIZE);
    }
  }

  // 🔁 Reset pagination when search changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchText]);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search installed apps..."
      onSearchTextChange={setSearchText}
      onSelectionChange={handleSelectionChange}
      throttle
    >
      {visibleApps.map((app) => (
        <List.Item
          key={app.path}
          id={app.path}
          title={app.name}
          icon={{ fileIcon: app.path }}
          accessories={[{ text: app.bundleId ?? "" }]}
          actions={
            <ActionPanel>
              <Action.Open title="Open App" target={app.path} />
              <Action.CopyToClipboard title="Copy Path" content={app.path} />
            </ActionPanel>
          }
        />
      ))}

      {/* Optional: show a "Load more" indicator */}
      {visibleCount < filteredApps.length && (
        <List.Item
          key="load-more"
          title="Scroll to load more..."
          icon="arrow-down"
          subtitle={`${visibleCount}/${filteredApps.length} apps`}
        />
      )}
    </List>
  );
}
