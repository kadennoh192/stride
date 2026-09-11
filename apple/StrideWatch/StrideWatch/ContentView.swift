import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if model.connected {
                WorkspaceView()
            } else {
                PairView()
            }
        }
        .overlay(alignment: .bottom) {
            if !model.message.isEmpty {
                Text(model.message)
                    .font(.caption2)
                    .multilineTextAlignment(.center)
                    .padding(8)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
            }
        }
        .task { if model.connected { await model.refresh() } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active && model.connected { Task { await model.refresh() } }
        }
    }
}

private struct PairView: View {
    @EnvironmentObject private var model: AppModel
    @State private var code = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Image(systemName: "bolt.fill")
                    .font(.title)
                    .foregroundStyle(.indigo)
                Text("Pair Stride")
                    .font(.headline)
                Text("Generate a code in Stride Settings → Apple Watch, then enter it here.")
                    .font(.caption2)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                TextField("8-character code", text: $code)
                    .textInputAutocapitalization(.characters)
                Button("Pair") {
                    Task { await model.pair(code: code.trimmingCharacters(in: .whitespacesAndNewlines)) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(code.count != 8 || model.busy)
                if model.busy { ProgressView() }
            }
            .padding(.horizontal, 6)
        }
    }
}

private struct WorkspaceView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView {
            TasksView()
            HabitsView()
            FocusView()
            SettingsView()
        }
        .tabViewStyle(.verticalPage)
        .overlay {
            if model.snapshot == nil && model.busy { ProgressView() }
        }
    }
}

private struct TasksView: View {
    @EnvironmentObject private var model: AppModel
    @State private var title = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Quick add") {
                    TextField("New task", text: $title)
                    Button("Add") {
                        let value = title.trimmingCharacters(in: .whitespacesAndNewlines)
                        title = ""
                        Task { await model.addTask(value) }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.busy)
                }
                Section("Upcoming") {
                    ForEach(model.snapshot?.tasks ?? []) { task in
                        Button {
                            Task { await model.complete(task) }
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(task.title)
                                    .lineLimit(2)
                                if !task.due.isEmpty {
                                    Text([task.due, task.time].filter { !$0.isEmpty }.joined(separator: " · "))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    if model.snapshot?.tasks.isEmpty == true { Text("Nothing due soon").foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Tasks")
        }
    }
}

private struct HabitsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            List(model.snapshot?.habits ?? []) { habit in
                Button {
                    Task { await model.log(habit) }
                } label: {
                    HStack {
                        Text(habit.icon.isEmpty ? "✓" : habit.icon)
                        VStack(alignment: .leading) {
                            Text(habit.title)
                            Text("\(habit.value, specifier: "%g") / \(habit.goal, specifier: "%g") \(habit.unit)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .disabled(habit.value >= habit.goal || model.busy)
            }
            .navigationTitle("Habits")
        }
    }
}

private struct FocusView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 12) {
            Text("Focus")
                .font(.headline)
            if let timer = model.snapshot?.timer, timer.running {
                Text(timer.endDate, style: .timer)
                    .font(.system(.title2, design: .rounded, weight: .semibold))
                    .monospacedDigit()
                Button("Pause") { Task { await model.pauseFocus() } }
                    .buttonStyle(.bordered)
            } else {
                Image(systemName: "timer")
                    .font(.largeTitle)
                    .foregroundStyle(.indigo)
                Button("Start 25 min") { Task { await model.startFocus(minutes: 25) } }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(.horizontal, 8)
    }
}

private struct SettingsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List {
            Button("Sync now") { Task { await model.refresh() } }
                .disabled(model.busy)
            if let snapshot = model.snapshot {
                LabeledContent("Timezone", value: snapshot.timezone)
                LabeledContent("Updated", value: snapshot.serverTime.prefix(16).replacingOccurrences(of: "T", with: " "))
            }
            if model.pendingCount > 0 {
                LabeledContent("Offline changes", value: String(model.pendingCount))
            }
            Button("Disconnect", role: .destructive) { model.disconnect() }
        }
    }
}
