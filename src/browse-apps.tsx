import {
  Action,
  ActionPanel,
  Application,
  Color,
  Form,
  getApplications,
  Icon,
  List,
  LocalStorage,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import Fuse from "fuse.js";
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 15;

interface AppTags {
  [bundleIdOrPath: string]: string[];
}

interface TagColors {
  [tag: string]: string;
}

export default function Command() {
  const [allApps, setAllApps] = useState<Application[]>([]);
  const [tags, setTags] = useState<AppTags>({});
  const [tagColors, setTagColors] = useState<TagColors>({});
  const [searchText, setSearchText] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(true);

  // 🚀 Load apps
  useEffect(() => {
    async function fetchApps() {
      const installedApps = await getApplications();
      installedApps.sort((a, b) => a.name.localeCompare(b.name));
      setAllApps(installedApps);
      setIsLoading(false);
    }
    fetchApps();
  }, []);

  // 💾 Load tags & colors
  useEffect(() => {
    async function loadTags() {
      const stored = await LocalStorage.allItems();
      const parsedTags: AppTags = {};
      const parsedColors: TagColors = {};

      for (const [key, value] of Object.entries(stored)) {
        if (key.startsWith("tagcolor:")) {
          const tagName = key.replace("tagcolor:", "");
          parsedColors[tagName] = value;
        } else {
          try {
            parsedTags[key] = JSON.parse(value);
          } catch {
            // skip
          }
        }
      }

      setTags(parsedTags);
      setTagColors(parsedColors);
    }
    loadTags();
  }, []);

  // 💾 Save tags
  async function saveTags(bundleIdOrPath: string, tagList: string[]) {
    const newTags = { ...tags, [bundleIdOrPath]: tagList };
    setTags(newTags);
    await LocalStorage.setItem(bundleIdOrPath, JSON.stringify(tagList));
  }

  // 🔍 Fuzzy search (Fuse.js)
  const fuse = useMemo(() => {
    return new Fuse(allApps, {
      keys: ["name"],
      threshold: 0.4, // tweak sensitivity (lower = stricter)
    });
  }, [allApps]);

  const filteredApps = useMemo(() => {
    if (!searchText) return allApps;

    // Tag search
    if (searchText.startsWith("#")) {
      const tagQuery = searchText.slice(1).toLowerCase();
      return allApps.filter((app) =>
        (tags[app.bundleId ?? app.path] ?? []).some((t) => t.toLowerCase().includes(tagQuery))
      );
    }

    // Fuzzy name search
    const results = fuse.search(searchText);
    return results.map((r) => r.item);
  }, [allApps, fuse, searchText, tags]);

  const visibleApps = filteredApps.slice(0, visibleCount);

  // Infinite scroll logic
  function handleSelectionChange(selectedId: string | null) {
    if (!selectedId) return;
    const index = visibleApps.findIndex((app) => app.path === selectedId);
    const nearEnd = index >= visibleApps.length - 5;
    if (nearEnd && visibleCount < filteredApps.length) {
      setVisibleCount((prev) => prev + PAGE_SIZE);
    }
  }

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchText]);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search apps or #tag..."
      onSearchTextChange={setSearchText}
      onSelectionChange={handleSelectionChange}
      throttle
    >
      {visibleApps.map((app) => {
        const appTags = tags[app.bundleId ?? app.path] ?? [];

        const accessories =
          appTags.length > 0
            ? appTags.map((t) => ({ tag: { value: t, color: tagColors[t] ?? Color.SecondaryText } }))
            : [];

        return (
          <List.Item
            key={app.path}
            id={app.path}
            title={app.name}
            icon={{ fileIcon: app.path }}
            accessories={accessories}
            actions={
              <ActionPanel>
                <Action.Open title="Open App" target={app.path} />
                <Action.CopyToClipboard title="Copy Path" content={app.path} />
                <Action.Push
                  title="Edit Tags"
                  icon={Icon.Tag}
                  target={
                    <TagEditor
                      app={app}
                      existingTags={appTags}
                      allTags={Object.keys(tagColors)}
                      onSave={(newTags) => saveTags(app.bundleId ?? app.path, newTags)}
                    />
                  }
                />
              </ActionPanel>
            }
          />
        );
      })}

      {visibleCount < filteredApps.length && (
        <List.Item
          key="load-more"
          title="Scroll to load more..."
          icon={Icon.ArrowDown}
          subtitle={`${visibleCount}/${filteredApps.length} apps`}
        />
      )}
    </List>
  );
}

// 🏷️ Tag Editor Form
function TagEditor({
  app,
  existingTags,
  allTags,
  onSave,
}: {
  app: Application;
  existingTags: string[];
  allTags: string[];
  onSave: (tags: string[]) => void;
}) {
  const { pop } = useNavigation();

  async function handleSubmit(values: { tags: string[] }) {
    await onSave(values.tags);
    await showToast({
      style: Toast.Style.Success,
      title: "Tags saved",
      message: `${values.tags.length} tag(s) for ${app.name}`,
    });
    pop();
  }

  return (
    <Form
      navigationTitle={`Tags for ${app.name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Tags" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TagPicker id="tags" title="Tags" defaultValue={existingTags}>
        {allTags.map((tag) => (
          <Form.TagPicker.Item key={tag} value={tag} title={tag} />
        ))}
      </Form.TagPicker>
    </Form>
  );
}
