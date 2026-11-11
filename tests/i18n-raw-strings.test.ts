import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs script, no types.
import { rawStrings } from '../scripts/i18n-raw-strings.mjs';

/**
 * Screens already moved to t() (docs/i18n.md): a new raw string in one of them fails here. Find a
 * file's raw strings with `node scripts/i18n-raw-strings.mjs <file>`; mark what is never translated
 * with `// i18n-ignore`.
 */
const MIGRATED: readonly string[] = [
  // The Mac's sidebar, Needs You (the bell, the chat's waiting cards, the request popup)
  'packages/mac/src/layout/Sidebar.tsx',
  'packages/mac/src/layout/SidebarSearch.tsx',
  'packages/mac/src/layout/CategorySections.tsx',
  'packages/mac/src/layout/UnreadSection.tsx',
  'packages/mac/src/layout/NotificationCenter.tsx',
  'packages/mac/src/chat/Attention.tsx',
  'packages/mac/src/popup/RequestPopup.tsx',
  // The Mac's composer and Settings
  'packages/mac/src/chat/Composer.tsx',
  'packages/mac/src/dialogs/Settings.tsx',
  // The Mac's task and plan pages
  'packages/mac/src/tasks/TaskPage.tsx',
  'packages/mac/src/plans/PlanPage.tsx',
  // The phone's main screens
  'packages/companion/app/(tabs)/_layout.tsx',
  'packages/companion/app/(tabs)/index.tsx',
  'packages/companion/app/(tabs)/chats.tsx',
  'packages/companion/app/(tabs)/work.tsx',
  'packages/companion/app/(tabs)/people.tsx',
  'packages/companion/app/needs.tsx',
  'packages/companion/app/need/[id].tsx',
  'packages/companion/components/Needs.tsx',
  // The Bots sidebar and Bot Studio, Combos, the model picker
  'packages/mac/src/bots/BotsSettings.tsx',
  'packages/mac/src/bots/BotsNav.tsx',
  'packages/mac/src/bots/BotPlanPane.tsx',
  'packages/mac/src/dialogs/CombosSettings.tsx',
  'packages/mac/src/chat/ModelPicker.tsx',
  'packages/mac/src/views/usage/CombosCard.tsx',
  // The Mac's Settings panes
  'packages/mac/src/dialogs/MachinesSettings.tsx',
  'packages/mac/src/dialogs/EnvironmentSettings.tsx',
  'packages/mac/src/dialogs/ExternalAgentsSettings.tsx',
  'packages/mac/src/dialogs/FireSettings.tsx',
  'packages/mac/src/dialogs/TerminalSettings.tsx',
  'packages/mac/src/dialogs/VoiceSettings.tsx',
  'packages/mac/src/dialogs/KeyboardSettings.tsx',
  'packages/mac/src/dialogs/LocalModelsSettings.tsx',
  'packages/mac/src/dialogs/MenuBarSettings.tsx',
  'packages/mac/src/dialogs/WebAccessSettings.tsx',
  'packages/mac/src/dialogs/NotificationSettings.tsx',
  'packages/mac/src/dialogs/ContextSettings.tsx',
  'packages/mac/src/dialogs/McpSettings.tsx',
  'packages/mac/src/dialogs/UsageLimitSettings.tsx',
  'packages/mac/src/dialogs/UpdateSettings.tsx',
  'packages/mac/src/dialogs/LaunchFlagsSettings.tsx',
  'packages/mac/src/dialogs/ParallelSettings.tsx',
  'packages/mac/src/dialogs/AgentThreadsSettings.tsx',
  'packages/mac/src/dialogs/ChatLimitSettings.tsx',
  'packages/mac/src/dialogs/EarningsSettings.tsx',
  'packages/mac/src/dialogs/ExperimentalSettings.tsx',
  'packages/mac/src/dialogs/EngineLocationSettings.tsx',
  'packages/mac/src/dialogs/TerminalThemes.tsx',
  'packages/mac/src/dialogs/TerminalImport.tsx',
  // The Mac's views: chat, files, diffs, reader, history, overview
  'packages/mac/src/views/ChangedFile.tsx',
  'packages/mac/src/views/ChatView.tsx',
  'packages/mac/src/views/DiffComment.tsx',
  'packages/mac/src/views/DiffView.tsx',
  'packages/mac/src/views/EarningsCard.tsx',
  'packages/mac/src/views/FilesView.tsx',
  'packages/mac/src/views/Overview.tsx',
  'packages/mac/src/views/ProjectHome.tsx',
  'packages/mac/src/views/SearchView.tsx',
  'packages/mac/src/views/SharedSearch.tsx',
  'packages/mac/src/views/TerminalTab.tsx',
  'packages/mac/src/views/TerminalView.tsx',
  'packages/mac/src/views/UsageView.tsx',
  'packages/mac/src/views/WorktreeInfo.tsx',
  'packages/mac/src/views/history/CommitDetail.tsx',
  'packages/mac/src/views/history/HistoryFilters.tsx',
  'packages/mac/src/views/history/HistoryList.tsx',
  'packages/mac/src/views/history/HistoryView.tsx',
  'packages/mac/src/views/history/HomeHistory.tsx',
  'packages/mac/src/views/overview/ConversationPeek.tsx',
  'packages/mac/src/views/overview/FilterBar.tsx',
  'packages/mac/src/views/overview/OverviewRows.tsx',
  'packages/mac/src/views/reader/EditTools.tsx',
  'packages/mac/src/views/reader/FileEditor.tsx',
  'packages/mac/src/views/reader/FileFocus.tsx',
  'packages/mac/src/views/reader/FileReader.tsx',
  'packages/mac/src/views/reader/PdfView.tsx',
  'packages/mac/src/views/reader/component-preview.tsx',
  'packages/mac/src/views/room/ConnectionStatus.tsx',
  // The Mac's sheets and the Usage screen
  'packages/mac/src/dialogs/AddProjectSheet.tsx',
  'packages/mac/src/dialogs/EarningsSheet.tsx',
  'packages/mac/src/dialogs/EnvironmentSheet.tsx',
  'packages/mac/src/dialogs/FolderBrowser.tsx',
  'packages/mac/src/dialogs/JoinSheet.tsx',
  'packages/mac/src/dialogs/MenuSheet.tsx',
  'packages/mac/src/dialogs/Palette.tsx',
  'packages/mac/src/dialogs/ReportProblemRow.tsx',
  'packages/mac/src/dialogs/SettingsSearch.tsx',
  'packages/mac/src/dialogs/SupportSheets.tsx',
  'packages/mac/src/dialogs/ThemePicker.tsx',
  'packages/mac/src/dialogs/UpdateSheet.tsx',
  'packages/mac/src/dialogs/sound/NotifyStatus.tsx',
  'packages/mac/src/dialogs/sound/SoundPicker.tsx',
  'packages/mac/src/dialogs/sound/SoundSettings.tsx',
  'packages/mac/src/dialogs/sound/TestNotification.tsx',
  'packages/mac/src/views/usage/ActivityCard.tsx',
  'packages/mac/src/views/usage/Breakdown.tsx',
  'packages/mac/src/views/usage/Calendar.tsx',
  'packages/mac/src/views/usage/CleanupCard.tsx',
  'packages/mac/src/views/usage/EarningsSummaryCard.tsx',
  'packages/mac/src/views/usage/HoursCard.tsx',
  'packages/mac/src/views/usage/PlanCard.tsx',
  'packages/mac/src/views/usage/Recap.tsx',
  'packages/mac/src/views/usage/SessionsCard.tsx',
  'packages/mac/src/views/usage/ShareCard.tsx',
  'packages/mac/src/views/usage/ShareSheet.tsx',
  'packages/mac/src/views/usage/StatsSection.tsx',
  'packages/mac/src/views/usage/StorageCard.tsx',
  'packages/mac/src/views/usage/TrendChart.tsx',
  'packages/mac/src/views/usage/YourCard.tsx',
  'packages/mac/src/views/usage/parts.tsx',
];

describe('migrated screens say every word through t()', () => {
  it('lists real files', () => {
    expect(MIGRATED.length).toBeGreaterThan(0);
  });
  for (const file of MIGRATED) {
    it(file, () => {
      const found = (rawStrings(file) as { line: number; text: string }[]).map((r) => `${file}:${r.line}  ${r.text}`);
      expect(found).toEqual([]);
    });
  }
});

describe('the raw-string finder', () => {
  it('finds JSX text and read props, and skips what is no words or marked', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'beluga-i18n-')), 'X.tsx');
    writeFileSync(
      file,
      [
        'export const X = ({ on }: { on: boolean }) => (',
        '  <div title="Open the plan" className="row-main">',
        '    Hello there',
        "    {on ? 'Turn off' : t('x.on')}",
        '    <Button label={t(\'x.save\')} icon="check" />',
        "    {' · '} 42 {/* i18n-ignore */}",
        '    Beluga {/* i18n-ignore */}',
        '  </div>',
        ');',
        "const OPTIONS = [{ value: 'a', label: 'Light' }];",
      ].join('\n'),
    );
    expect((rawStrings(file) as { line: number; text: string }[]).map((r) => [r.line, r.text])).toEqual([
      [2, 'Open the plan'],
      [3, 'Hello there'],
      [4, 'Turn off'],
      [10, 'Light'],
    ]);
  });
});
