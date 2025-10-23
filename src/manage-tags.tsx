import { Action, ActionPanel, Form, Icon, List, LocalStorage, showToast, Toast, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";

interface TagColors {
  [tag: string]: string;
}

export default function ManageTagsCommand() {
  const [tagColors, setTagColors] = useState<TagColors>({});
  const [isLoading, setIsLoading] = useState(true);

  async function loadTags() {
    const stored = await LocalStorage.allItems();
    const parsedColors: TagColors = {};
    for (const [key, value] of Object.entries(stored)) {
      if (key.startsWith("tagcolor:")) {
        const tagName = key.replace("tagcolor:", "");
        parsedColors[tagName] = value;
      }
    }
    setTagColors(parsedColors);
    setIsLoading(false);
  }

  useEffect(() => {
    loadTags();
  }, []);

  async function handleCreateTag(tagName: string, color: string) {
    if (!tagName) {
      showToast(Toast.Style.Failure, "Tag name cannot be empty");
      return;
    }
    if (!/^#[0-9A-F]{6}$/i.test(color)) {
      showToast(Toast.Style.Failure, "Invalid HEX color", "Please use format like #FF0000");
      return;
    }

    const newTagColors = { ...tagColors, [tagName]: color };
    setTagColors(newTagColors);
    await LocalStorage.setItem(`tagcolor:${tagName}`, color);
    showToast(Toast.Style.Success, "Tag Created", `Added new tag: ${tagName}`);
  }

  async function handleEditTag(oldTagName: string, newTagName: string, color: string) {
    if (!/^#[0-9A-F]{6}$/i.test(color)) {
      showToast(Toast.Style.Failure, "Invalid HEX color", "Please use format like #FF0000");
      return;
    }

    const newTagColors = { ...tagColors };

    if (oldTagName !== newTagName) {
      delete newTagColors[oldTagName];
      await LocalStorage.removeItem(`tagcolor:${oldTagName}`);

      // Update apps that use the old tag
      const allItems = await LocalStorage.allItems();
      for (const key in allItems) {
        if (!key.startsWith("tagcolor:")) {
          try {
            const tags = JSON.parse(allItems[key]);
            const newTags = tags.map((t: string) => (t === oldTagName ? newTagName : t));
            if (JSON.stringify(tags) !== JSON.stringify(newTags)) {
              await LocalStorage.setItem(key, JSON.stringify(newTags));
            }
          } catch (error) {
            // ignore non-json values
          }
        }
      }
    }

    newTagColors[newTagName] = color;
    setTagColors(newTagColors);
    await LocalStorage.setItem(`tagcolor:${newTagName}`, color);
    showToast(Toast.Style.Success, "Tag Updated", `Saved changes for ${newTagName}`);
  }

  async function handleDeleteTag(tagName: string) {
    const newTagColors = { ...tagColors };
    delete newTagColors[tagName];
    setTagColors(newTagColors);
    await LocalStorage.removeItem(`tagcolor:${tagName}`);

    // Also remove this tag from any apps that have it
    const allItems = await LocalStorage.allItems();
    for (const key in allItems) {
      if (!key.startsWith("tagcolor:")) {
        try {
          const tags = JSON.parse(allItems[key]);
          const newTags = tags.filter((t: string) => t !== tagName);
          if (newTags.length !== tags.length) {
            await LocalStorage.setItem(key, JSON.stringify(newTags));
          }
        } catch (error) {
          // ignore non-json values
        }
      }
    }

    showToast(Toast.Style.Success, "Tag Deleted", `Removed tag: ${tagName}`);
  }

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Manage Tags"
      actions={
        <ActionPanel>
          <Action.Push title="Create New Tag" icon={Icon.Plus} target={<CreateTagForm onCreate={handleCreateTag} />} />
        </ActionPanel>
      }
    >
      {Object.entries(tagColors).map(([tagName, color]) => (
        <List.Item
          key={tagName}
          title={tagName}
          icon={{ source: Icon.Tag, tintColor: color }}
          actions={
            <ActionPanel>
              <Action.Push
                title="Create New Tag"
                icon={Icon.Plus}
                target={<CreateTagForm onCreate={handleCreateTag} />}
              />
              <Action.Push
                title="Edit Tag"
                icon={Icon.Pencil}
                target={<EditTagForm tagName={tagName} currentColor={color} onEdit={handleEditTag} />}
              />
              <Action
                title="Delete Tag"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={() => handleDeleteTag(tagName)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function CreateTagForm({ onCreate }: { onCreate: (tagName: string, color: string) => void }) {
  const { pop } = useNavigation();

  function handleSubmit(values: { tagName: string; color: string }) {
    onCreate(values.tagName, values.color);
    pop();
  }

  return (
    <Form
      navigationTitle="Create New Tag"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Tag" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="tagName" title="Tag Name" placeholder="e.g. development" />
      <Form.TextField id="color" title="Tag Color (HEX)" placeholder="e.g. #FF0000" />
    </Form>
  );
}

function EditTagForm({
  tagName,
  currentColor,
  onEdit,
}: {
  tagName: string;
  currentColor: string;
  onEdit: (oldTagName: string, newTagName: string, color: string) => void;
}) {
  const { pop } = useNavigation();

  function handleSubmit(values: { tagName: string; color: string }) {
    onEdit(tagName, values.tagName, values.color);
    pop();
  }

  return (
    <Form
      navigationTitle={`Edit "${tagName}"`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Changes" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="tagName" title="Tag Name" defaultValue={tagName} />
      <Form.TextField id="color" title="New Color (HEX)" defaultValue={currentColor} placeholder="e.g. #00FF00" />
    </Form>
  );
}
