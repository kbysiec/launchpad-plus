import {
  Action,
  ActionPanel,
  Application,
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
import { useCallback, useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 15;
const TAG_ORDER_KEY = "tagorder";
const TAG_DEFINITIONS_KEY = "tagdefinitions";
const REFRESH_KEY = "refreshVersion";

interface AppTags {
  [bundleIdOrPath: string]: string[];
}

interface TagDefinition {
  id: string;
  name: string;
  color: string;
}

interface TagDefinitions {
  [id: string]: TagDefinition;
}

/* -------------------------------------------------------------------------- */
/*                                Root Command                                */
/* -------------------------------------------------------------------------- */

export default function Command() {
  const [allApps, setAllApps] = useState<Application[]>([]);
  const [tags, setTags] = useState<AppTags>({});
  const [tagDefinitions, setTagDefinitions] = useState<TagDefinitions>({});
  const [tagOrder, setTagOrder] = useState<string[]>([]);
  const [searchText, setSearchText] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState<string | null>(null);

  /* ------------------------------ Load Data ------------------------------ */
  const loadData = useCallback(async () => {
    setIsLoading(true);

    const installedApps = await getApplications();
    installedApps.sort((a, b) => a.name.localeCompare(b.name));
    setAllApps(installedApps);

    const stored = await LocalStorage.allItems();
    const parsedTags: AppTags = {};
    let definitions: TagDefinitions = {};
    let order: string[] = [];

    if (stored[TAG_DEFINITIONS_KEY]) {
      try {
        definitions = JSON.parse(stored[TAG_DEFINITIONS_KEY] as string);
      } catch {
        definitions = {};
      }
    }

    if (stored[TAG_ORDER_KEY]) {
      try {
        order = JSON.parse(stored[TAG_ORDER_KEY] as string);
      } catch {
        order = [];
      }
    }

    for (const [key, value] of Object.entries(stored)) {
      if ([TAG_DEFINITIONS_KEY, TAG_ORDER_KEY, REFRESH_KEY].includes(key)) continue;
      try {
        const parsed = JSON.parse(value as string);
        if (Array.isArray(parsed)) parsedTags[key] = parsed;
        // eslint-disable-next-line no-empty
      } catch {}
    }

    const allTagIds = Object.keys(definitions);
    if (order.length === 0) order = allTagIds;
    else order = [...order.filter((id) => allTagIds.includes(id)), ...allTagIds.filter((id) => !order.includes(id))];

    setTags(parsedTags);
    setTagDefinitions(definitions);
    setTagOrder(order);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const version = await LocalStorage.getItem<string>(REFRESH_KEY);
      if (version && version !== refreshVersion) {
        setRefreshVersion(version);
        await loadData();
      }
    }, 800);
    return () => clearInterval(interval);
  }, [refreshVersion, loadData]);

  async function persistRefreshVersion() {
    await LocalStorage.setItem(REFRESH_KEY, Date.now().toString());
  }

  async function persistTagOrder(order: string[]) {
    setTagOrder(order);
    await LocalStorage.setItem(TAG_ORDER_KEY, JSON.stringify(order));
  }

  /* ------------------------------- App Tags ------------------------------- */
  async function saveTags(bundleIdOrPath: string, tagList: string[]) {
    const newTags = { ...tags, [bundleIdOrPath]: tagList };
    setTags(newTags);
    await LocalStorage.setItem(bundleIdOrPath, JSON.stringify(tagList));
    await persistRefreshVersion();
  }

  /* ------------------------------- Create Tag ------------------------------ */
  async function createTag(name: string, color: string) {
    const id = generateId();

    const defsStr = await LocalStorage.getItem<string>(TAG_DEFINITIONS_KEY);
    const defs: TagDefinitions = defsStr ? JSON.parse(defsStr) : {};
    defs[id] = { id, name, color };

    await LocalStorage.setItem(TAG_DEFINITIONS_KEY, JSON.stringify(defs));
    setTagDefinitions(defs);

    const orderStr = await LocalStorage.getItem<string>(TAG_ORDER_KEY);
    let order: string[] = orderStr ? JSON.parse(orderStr) : [];
    order = [...order, id];
    await persistTagOrder(order);

    await persistRefreshVersion();
    await showToast(Toast.Style.Success, "Tag Created", `Added ${name}`);
  }

  /* -------------------------------- Edit Tag ------------------------------- */
  async function editTag(id: string, newName: string, newColor: string) {
    const defsStr = await LocalStorage.getItem<string>(TAG_DEFINITIONS_KEY);
    const defs: TagDefinitions = defsStr ? JSON.parse(defsStr) : {};
    if (!defs[id]) return;

    defs[id] = { id, name: newName, color: newColor };
    await LocalStorage.setItem(TAG_DEFINITIONS_KEY, JSON.stringify(defs));
    setTagDefinitions(defs);

    await persistRefreshVersion();
    await showToast(Toast.Style.Success, "Tag Updated", `Updated ${newName}`);
  }

  /* ------------------------------- Delete Tag ------------------------------ */
  async function deleteTag(id: string) {
    // Load latest definitions
    const defsStr = await LocalStorage.getItem<string>(TAG_DEFINITIONS_KEY);
    const defs: TagDefinitions = defsStr ? JSON.parse(defsStr) : {};
    delete defs[id];

    // Remove tag from apps
    const updatedTags: AppTags = { ...tags };
    for (const key in updatedTags) {
      const current = updatedTags[key];
      if (Array.isArray(current)) {
        updatedTags[key] = current.filter((tagId) => tagId !== id);
        await LocalStorage.setItem(key, JSON.stringify(updatedTags[key]));
      }
    }
    setTags(updatedTags);

    // Update order safely
    const orderStr = await LocalStorage.getItem<string>(TAG_ORDER_KEY);
    let order: string[] = orderStr ? JSON.parse(orderStr) : [];
    order = order.filter((tagId) => tagId !== id);
    await persistTagOrder(order);

    // Save merged definitions
    await LocalStorage.setItem(TAG_DEFINITIONS_KEY, JSON.stringify(defs));
    setTagDefinitions(defs);

    await persistRefreshVersion();
    await showToast(Toast.Style.Success, "Tag Deleted", "Tag removed successfully");
  }

  /* ------------------------------ Search Logic ----------------------------- */
  const fuse = useMemo(() => new Fuse(allApps, { keys: ["name"], threshold: 0.4 }), [allApps]);
  const filteredApps = useMemo(() => {
    if (!searchText) return allApps;
    if (searchText.startsWith("#")) {
      const q = searchText.slice(1).toLowerCase();
      return allApps.filter((a) => {
        const appTagIds = tags[a.bundleId ?? a.path] ?? [];
        return appTagIds.some((id) => tagDefinitions[id]?.name.toLowerCase().includes(q));
      });
    }
    return fuse.search(searchText).map((r) => r.item);
  }, [allApps, fuse, searchText, tags, tagDefinitions]);

  const visibleApps = filteredApps.slice(0, visibleCount);
  useEffect(() => setVisibleCount(PAGE_SIZE), [searchText]);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search apps or #tag..."
      onSearchTextChange={setSearchText}
      onSelectionChange={(id) => {
        if (!id) return;
        const index = visibleApps.findIndex((a) => a.path === id);
        if (index >= visibleApps.length - 5 && visibleCount < filteredApps.length) {
          setVisibleCount((v) => v + PAGE_SIZE);
        }
      }}
      throttle
    >
      {visibleApps.map((app) => {
        const appTagIds = tags[app.bundleId ?? app.path] ?? [];
        const accessories = appTagIds
          .map((id) => tagDefinitions[id])
          .filter(Boolean)
          .map((def) => ({ tag: { value: def!.name, color: def!.color } }));

        return (
          <List.Item
            key={app.path}
            title={app.name}
            icon={{ fileIcon: app.path }}
            accessories={accessories}
            actions={
              <ActionPanel>
                <Action.Open title="Open App" target={app.path} />
                <Action.Push
                  title="Edit Tags"
                  icon={Icon.Tag}
                  target={
                    <TagEditor
                      app={app}
                      onSave={(newTags) => saveTags(app.bundleId ?? app.path, newTags)}
                      onCreateGlobal={createTag}
                      onEditGlobal={editTag}
                      onDeleteGlobal={deleteTag}
                      tagOrder={tagOrder}
                    />
                  }
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Tag Editor                                 */
/* -------------------------------------------------------------------------- */

function TagEditor({
  app,
  onSave,
  onCreateGlobal,
  onEditGlobal,
  onDeleteGlobal,
  tagOrder,
}: {
  app: Application;
  onSave: (tags: string[]) => void;
  onCreateGlobal: (name: string, color: string) => void;
  onEditGlobal: (id: string, newName: string, newColor: string) => void;
  onDeleteGlobal: (id: string) => void;
  tagOrder: string[];
}) {
  const { pop } = useNavigation();
  const [tagDefinitions, setTagDefinitions] = useState<TagDefinitions>({});
  const [availableTagIds, setAvailableTagIds] = useState<string[]>(tagOrder);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [pickerVersion, setPickerVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const bumpPicker = () => setPickerVersion((v) => v + 1);

  const loadFromStorage = useCallback(async () => {
    const stored = await LocalStorage.allItems();
    let defs: TagDefinitions = {};
    if (stored[TAG_DEFINITIONS_KEY]) {
      try {
        defs = JSON.parse(stored[TAG_DEFINITIONS_KEY] as string);
      } catch {
        defs = {};
      }
    }

    let order: string[] = tagOrder;
    if (stored[TAG_ORDER_KEY]) {
      try {
        order = JSON.parse(stored[TAG_ORDER_KEY] as string);
      } catch {
        order = tagOrder;
      }
    }

    setTagDefinitions(defs);
    setAvailableTagIds(order);

    const raw = stored[app.bundleId ?? app.path];
    if (raw) {
      try {
        const parsed = JSON.parse(raw as string);
        if (Array.isArray(parsed)) setSelectedTagIds(parsed);
        // eslint-disable-next-line no-empty
      } catch {}
    }

    setIsLoading(false);
    bumpPicker();
  }, [app.bundleId, app.path, tagOrder]);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  async function handleSubmit(values: { tags: string[] }) {
    await onSave(values.tags);
    await showToast({ style: Toast.Style.Success, title: "Tags saved" });
    pop();
  }

  async function createLocal(name: string, color: string) {
    await onCreateGlobal(name, color);
    await new Promise((r) => setTimeout(r, 150));
    await loadFromStorage();
  }

  async function editLocal(id: string, newName: string, newColor: string) {
    await onEditGlobal(id, newName, newColor);
    await new Promise((r) => setTimeout(r, 150));
    await loadFromStorage();
  }

  async function deleteLocal(id: string) {
    await onDeleteGlobal(id);
    await new Promise((r) => setTimeout(r, 150));
    await loadFromStorage();
  }

  if (isLoading) return <List isLoading navigationTitle={`Tags for ${app.name}`} />;

  return (
    <Form
      navigationTitle={`Tags for ${app.name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save" onSubmit={handleSubmit} />
          <Action.Push
            title="Manage Tags"
            icon={Icon.Gear}
            target={<ManageTags onCreate={createLocal} onEdit={editLocal} onDelete={deleteLocal} />}
          />
        </ActionPanel>
      }
    >
      <Form.TagPicker id="tags" key={pickerVersion} title="Tags" value={selectedTagIds} onChange={setSelectedTagIds}>
        {availableTagIds.map((tagId) => {
          const def = tagDefinitions[tagId];
          if (!def) return null;
          return (
            <Form.TagPicker.Item
              key={`${pickerVersion}-${tagId}`}
              value={tagId}
              title={def.name}
              icon={{ source: Icon.Tag, tintColor: def.color }}
            />
          );
        })}
      </Form.TagPicker>
    </Form>
  );
}

/* -------------------------------------------------------------------------- */
/*                           Manage Tags + CRUD Forms                         */
/* -------------------------------------------------------------------------- */

function ManageTags({
  onCreate,
  onEdit,
  onDelete,
}: {
  onCreate: (name: string, color: string) => void;
  onEdit: (id: string, newName: string, newColor: string) => void;
  onDelete: (id: string) => void;
}) {
  const [tagDefinitions, setTagDefinitions] = useState<TagDefinitions>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const defsStr = await LocalStorage.getItem<string>(TAG_DEFINITIONS_KEY);
      if (!defsStr || cancelled) return;
      try {
        setTagDefinitions(JSON.parse(defsStr));
        // eslint-disable-next-line no-empty
      } catch {}
    }
    load();
    const interval = setInterval(load, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <List navigationTitle="Manage Tags">
      {Object.values(tagDefinitions).map((def) => (
        <List.Item
          key={def.id}
          title={def.name}
          icon={{ source: Icon.Tag, tintColor: def.color }}
          actions={
            <ActionPanel>
              <Action.Push title="Edit Tag" icon={Icon.Pencil} target={<EditTagForm tagDef={def} onEdit={onEdit} />} />
              <Action
                title="Delete Tag"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={() => onDelete(def.id)}
              />
            </ActionPanel>
          }
        />
      ))}
      <List.Item
        key="create"
        title="Create New Tag"
        icon={Icon.Plus}
        actions={
          <ActionPanel>
            <Action.Push title="Create" icon={Icon.Plus} target={<CreateTagForm onCreate={onCreate} />} />
          </ActionPanel>
        }
      />
    </List>
  );
}

function CreateTagForm({ onCreate }: { onCreate: (name: string, color: string) => void }) {
  const { pop } = useNavigation();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#FF0000");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handle() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    if (!name) {
      await showToast(Toast.Style.Failure, "Tag name cannot be empty");
      setIsSubmitting(false);
      return;
    }
    if (!/^#[0-9A-F]{6}$/i.test(color)) {
      await showToast(Toast.Style.Failure, "Invalid HEX color", "Use #RRGGBB like #FF0000");
      setIsSubmitting(false);
      return;
    }
    await onCreate(name, color);
    pop();
  }

  return (
    <Form
      navigationTitle="Create Tag"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create" onSubmit={handle} />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Tag Name" placeholder="e.g. Work" value={name} onChange={setName} />
      <Form.TextField id="color" title="Color (HEX)" value={color} onChange={setColor} />
    </Form>
  );
}

function EditTagForm({
  tagDef,
  onEdit,
}: {
  tagDef: TagDefinition;
  onEdit: (id: string, newName: string, newColor: string) => void;
}) {
  const { pop } = useNavigation();
  const [name, setName] = useState(tagDef.name);
  const [color, setColor] = useState(tagDef.color);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handle() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    if (!name) {
      await showToast(Toast.Style.Failure, "Tag name cannot be empty");
      setIsSubmitting(false);
      return;
    }
    if (!/^#[0-9A-F]{6}$/i.test(color)) {
      await showToast(Toast.Style.Failure, "Invalid HEX color", "Use #RRGGBB like #00FF00");
      setIsSubmitting(false);
      return;
    }
    await onEdit(tagDef.id, name, color);
    pop();
  }

  return (
    <Form
      navigationTitle={`Edit ${tagDef.name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Changes" onSubmit={handle} />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Tag Name" value={name} onChange={setName} />
      <Form.TextField id="color" title="Color (HEX)" value={color} onChange={setColor} />
    </Form>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function generateId(): string {
  return `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
