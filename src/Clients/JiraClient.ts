import AgileTaskNotesPlugin, { AgileTaskNotesPluginSettingTab, AgileTaskNotesSettings } from 'main';
import { App, normalizePath, requestUrl, Setting, TAbstractFile, TFile } from 'obsidian';
import { Task } from 'src/Task';
import { VaultHelper } from 'src/VaultHelper';
import { ITfsClient } from './ITfsClient';

export interface JiraSettings {
  baseUrl: string;
  usernames: string;
  email: string;
  apiToken: string;
}

export const JIRA_DEFAULT_SETTINGS: JiraSettings = {
  baseUrl: '{yourserver}.atlassian.net',
  usernames: '',
  email: '',
  apiToken: '',
};

export class JiraClient implements ITfsClient {
  clientName = 'Jira';

  constructor(private app: App) {}

  public async update(settings: AgileTaskNotesSettings): Promise<void> {
    const headers = {
      Authorization: '',
      'Content-Type': 'application/json',
    };
    const encoded64Key = Buffer.from(`${settings.jiraSettings.email}:${settings.jiraSettings.apiToken}`).toString(
      'base64'
    );
    headers.Authorization = `Basic ${encoded64Key}`;

    const assignees = settings.jiraSettings.usernames
      .trim()
      .split(',\n')
      .map((s) => s.trim().slice(1, -1));
    console.log(assignees);
    try {
      const { targetFolder, jiraSettings, noteTemplate, noteName } = settings;
      const completedFolder = `${targetFolder}/Completed/`;
      const normalizedBaseFolderPath = normalizePath(targetFolder);
      const normalizedCompletedFolderPath = normalizePath(completedFolder);

      VaultHelper.createFoldersFromList([normalizedBaseFolderPath, normalizedCompletedFolderPath], this.app);

      const assigneeQuery = assignees.map((id) => `assignee=${id}`).join(' OR ');
      const query = `(${assigneeQuery}) AND status NOT IN (Closed, Rejected, Done, Deployed, Live) ORDER BY created DESC`;
      const encodedQuery = encodeURIComponent(query);
      const url = `https://${jiraSettings.baseUrl}/rest/api/3/search?jql=${encodedQuery}&maxResults=1000`;

      const issueResponseList = await requestUrl({
        method: 'GET',
        headers,
        url,
      });

      const extractTextFromContent = (content: any) => {
        if (!content) return '';

        return content
          .map((block: any) => {
            switch (block.type) {
              case 'paragraph':
                return block.content.map((contentItem: any) => contentItem.text || '').join(' ');

              case 'orderedList':
                return block.content
                  .map((item: any, index: any) => {
                    const listItemText = item.content ? extractTextFromContent(item.content) : '';
                    return `${block.attrs.order + index}. ${listItemText}`; 
                  })
                  .join('\n');

              case 'bulletList':
                return block.content
                  .map((item: any) => {
                    const listItemText = item.content ? extractTextFromContent(item.content) : '';
                    return `- ${listItemText}`;
                  })
                  .join('\n');

              default:
                return '';
            }
          })
          .join('\n\n');
      };

      const activeTasks = issueResponseList.json.issues
        .map((issue: any) => {
          const assignee = issue.fields['assignee'];
          const assigneeName = assignee ? assignee['displayName'] : 'Unassigned';
          // console.log(issue)

          const descriptionField = issue.fields['description'];
          const descriptionContent = descriptionField ? descriptionField.content : [];
          const descriptionText = extractTextFromContent(descriptionContent);

          const sprint = issue.fields['customfield_10020'];
          const sprintName = sprint && sprint.length > 0 ? sprint[0].name : 'No Name';

          return new Task({
            id: issue.key,
            state: issue.fields['status']['name'],
            title: issue.fields['summary'],
            type: issue.fields['issuetype']['name'],
            assignedTo: assigneeName,
            link: `https://${jiraSettings.baseUrl}/browse/${issue.key}`,
            desc: descriptionText,
            sprintName,
          });
        })
        .filter(
          (task: { assignedTo: string | string[]; state: string }) =>
            !(task.assignedTo.includes('Venet') && (task.state === 'Backlog') || (task.state === 'PM Evaluation') || (task.state === 'Ready for Engineering'))
        );

      // Create task notes
      await Promise.all(
        VaultHelper.createTaskNotes(normalizedBaseFolderPath, activeTasks, noteTemplate, noteName, this.app)
      );

      // Rename task note files
      const activeTaskNoteFiles = activeTasks
        .map((task: { id: string }) => VaultHelper.getFileByTaskId(targetFolder, task.id, this.app))
        .filter((file: any): file is TFile => !!file);

      activeTaskNoteFiles.forEach((file: TAbstractFile) =>
        this.app.vault.rename(file, normalizePath(`${targetFolder}/${file.name}`))
      );

      // Create Kanban board
      const columnOrder = [
        'Backlog',
        'Blocked',
        'In Analysis',
        'To Do',
        'Ready for Engineering',
        'Ready to Start',
        'In Progress',
        'In Validation',
      ];

      const columnIds = [...new Set(activeTasks.map((task: { state: string }) => task.state as string))].sort(
        (a, b) => {
          const indexA = columnOrder.indexOf(a as string);
          const indexB = columnOrder.indexOf(b as string);

          if (indexA === -1 && indexB === -1) return 0;
          if (indexA === -1) return 1;
          if (indexB === -1) return -1;

          return indexA - indexB;
        }
      );

      const boardID = 'FP';
      await VaultHelper.createKanbanBoard(
        normalizedBaseFolderPath,
        activeTasks,
        columnIds as string[],
        boardID,
        this.app
      );
    } catch (e) {
      VaultHelper.logError(e);
    }
  }

  public setupSettings(
    container: HTMLElement,
    plugin: AgileTaskNotesPlugin,
    settingsTab: AgileTaskNotesPluginSettingTab
  ): any {
    container.createEl('h2', { text: 'Jira Remote Repo Settings' });

    new Setting(container)
      .setName('URL')
      .setDesc('The base URL of your Jira server or {ip:port}')
      .addText((text) =>
        text
          .setPlaceholder('Enter Jira base URL')
          .setValue(plugin.settings.jiraSettings.baseUrl)
          .onChange(async (value) => {
            plugin.settings.jiraSettings.baseUrl = value;
            await plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName('Usernames')
      .setDesc(
        'A comma-separated list of usernames you want the tasks of. Simply put your username if you only need your own.'
      )
      .addText((text) =>
        text
          .setPlaceholder('Enter usernames')
          .setValue(plugin.settings.jiraSettings.usernames)
          .onChange(async (value) => {
            plugin.settings.jiraSettings.usernames = value;
            await plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName('Email')
      .setDesc('The email of your Atlassian account for Jira')
      .addText((text) =>
        text
          .setPlaceholder('Enter Atlassian email')
          .setValue(plugin.settings.jiraSettings.email)
          .onChange(async (value) => {
            plugin.settings.jiraSettings.email = value;
            await plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName('API Token')
      .setDesc('The API token generated with your account')
      .addText((text) =>
        text
          .setPlaceholder('Enter API token')
          .setValue(plugin.settings.jiraSettings.apiToken)
          .onChange(async (value) => {
            plugin.settings.jiraSettings.apiToken = value;
            await plugin.saveSettings();
          })
      );
  }
}
