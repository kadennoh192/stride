import Combine
import Foundation
import UserNotifications

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var snapshot = OfflineStore.snapshot()
    @Published private(set) var connected = CredentialStore.read() != nil
    @Published private(set) var busy = false
    @Published private(set) var pendingCount = OfflineStore.queue().count
    @Published var message = ""

    private let api: WatchAPI?
    private var token: String? { CredentialStore.read() }

    init() {
        api = try? WatchAPI()
        if api == nil { message = StoreError.invalidOrigin.localizedDescription }
    }

    func pair(code: String) async {
        // A new pairing is a new workspace boundary. Never replay cached actions
        // from the revoked credential, even if pairing or refresh fails.
        disconnect()
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        await run {
            guard let api else { throw StoreError.invalidOrigin }
            let result = try await api.pair(code: code)
            try CredentialStore.save(result.token)
            connected = true
            snapshot = try await api.refresh(token: result.token)
            persist()
        }
    }

    func refresh() async {
        await run {
            guard let api, let token else { return }
            try await replayPending(using: api, token: token)
            snapshot = try await api.refresh(token: token)
            persist()
        }
    }

    func complete(_ task: WatchTask) async {
        await perform(.completeTask(id: task.id))
    }

    func addTask(_ title: String) async {
        await perform(.createTask(id: UUID().uuidString, title: title))
    }

    func log(_ habit: WatchHabit) async {
        guard let date = snapshot?.today else { return }
        await perform(.logHabit(id: habit.id, date: date, value: min(habit.goal, habit.value + 1)))
    }

    func startFocus(minutes: Int, task: String = "") async {
        await perform(
            .startTimer(
                minutes: minutes,
                task: task,
                startedAt: Date().timeIntervalSince1970 * 1_000
            )
        )
        guard let timer = snapshot?.timer, timer.running else { return }
        let center = UNUserNotificationCenter.current()
        if (try? await center.requestAuthorization(options: [.alert, .sound])) == true {
            let content = UNMutableNotificationContent()
            content.title = "Focus interval complete"
            content.body = "Your next Stride interval is ready."
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(
                timeInterval: max(1, timer.endDate.timeIntervalSinceNow),
                repeats: false
            )
            try? await center.add(UNNotificationRequest(identifier: "stride-focus", content: content, trigger: trigger))
        }
    }

    func pauseFocus() async {
        let remaining: Double
        if let timer = snapshot?.timer {
            remaining = timer.running
                ? max(0, timer.endDate.timeIntervalSinceNow)
                : timer.remaining
        } else {
            remaining = 0
        }
        await perform(.pauseTimer(remaining: remaining))
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["stride-focus"])
    }

    func disconnect() {
        CredentialStore.remove()
        snapshot = nil
        connected = false
        pendingCount = 0
        OfflineStore.removeAll()
        message = ""
    }

    private func perform(_ action: WatchAction) async {
        guard !busy, let api, let token else { return }
        busy = true
        message = ""
        defer { busy = false }
        do {
            try await replayPending(using: api, token: token)
            snapshot = try await api.perform(action, token: token)
            persist()
        } catch is URLError {
            enqueue(action)
        } catch StoreError.server(let status, _) where status >= 500 {
            enqueue(action)
        } catch {
            handle(error)
        }
    }

    private func run(_ operation: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        message = ""
        defer { busy = false }
        do {
            try await operation()
        } catch {
            handle(error)
        }
    }

    private func persist() {
        OfflineStore.save(snapshot: snapshot)
    }

    private func replayPending(using api: WatchAPI, token: String) async throws {
        var pending = OfflineStore.queue()
        while let action = pending.first {
            snapshot = try await api.perform(action, token: token)
            pending.removeFirst()
            OfflineStore.save(queue: pending)
            pendingCount = pending.count
            persist()
        }
    }

    private func handle(_ error: Error) {
        message = error.localizedDescription
        if case StoreError.server(let status, let text) = error, status == 401 {
            disconnect()
            message = text
        }
    }

    private func enqueue(_ action: WatchAction) {
        var pending = OfflineStore.queue()
        guard pending.count < 100 else {
            message = "The offline queue is full. Reconnect before making more changes."
            return
        }
        pending.append(action)
        OfflineStore.save(queue: pending)
        pendingCount = pending.count
        applyLocally(action)
        persist()
        message = "Saved on this watch. It will sync after reconnecting."
    }

    private func applyLocally(_ action: WatchAction) {
        var current = snapshot ?? emptySnapshot()
        switch action {
        case .createTask(let id, let title):
            current.tasks.append(
                WatchTask(
                    id: id,
                    title: title,
                    due: "",
                    time: "",
                    priority: 4,
                    tags: [],
                    project: "inbox"
                )
            )
        case .completeTask(let id):
            current.tasks.removeAll { $0.id == id }
        case .logHabit(let id, _, let value):
            if let index = current.habits.firstIndex(where: { $0.id == id }) {
                let habit = current.habits[index]
                current.habits[index] = WatchHabit(
                    id: habit.id,
                    title: habit.title,
                    icon: habit.icon,
                    goal: habit.goal,
                    unit: habit.unit,
                    value: value
                )
            }
        case .startTimer(let minutes, let task, let startedAt):
            let duration = Double(minutes * 60)
            current.timer = WatchTimer(
                id: UUID().uuidString,
                phase: "focus",
                duration: duration,
                remaining: duration,
                end: startedAt + duration * 1_000,
                running: true,
                cycle: 1,
                task: task
            )
        case .pauseTimer(let remaining):
            if let timer = current.timer {
                current.timer = WatchTimer(
                    id: timer.id,
                    phase: timer.phase,
                    duration: timer.duration,
                    remaining: remaining,
                    end: 0,
                    running: false,
                    cycle: timer.cycle,
                    task: timer.task
                )
            }
        }
        snapshot = current
    }

    private func emptySnapshot() -> WatchSnapshot {
        let formatter = ISO8601DateFormatter()
        let day = DateFormatter()
        day.calendar = Calendar(identifier: .gregorian)
        day.locale = Locale(identifier: "en_CA_POSIX")
        day.timeZone = .current
        day.dateFormat = "yyyy-MM-dd"
        return WatchSnapshot(
            version: 1,
            serverTime: formatter.string(from: Date()),
            today: day.string(from: Date()),
            timezone: TimeZone.current.identifier,
            tasks: [],
            habits: [],
            timer: nil
        )
    }
}
