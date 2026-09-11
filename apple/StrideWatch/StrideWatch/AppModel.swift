import Combine
import Foundation
import UserNotifications

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var snapshot: WatchSnapshot?
    @Published private(set) var connected = CredentialStore.read() != nil
    @Published private(set) var busy = false
    @Published var message = ""

    private let api: WatchAPI?
    private var token: String? { CredentialStore.read() }

    init() {
        api = try? WatchAPI()
        if api == nil { message = StoreError.invalidOrigin.localizedDescription }
    }

    func pair(code: String) async {
        await run {
            guard let api else { throw StoreError.invalidOrigin }
            let result = try await api.pair(code: code)
            try CredentialStore.save(result.token)
            connected = true
            snapshot = try await api.refresh(token: result.token)
        }
    }

    func refresh() async {
        await run {
            guard let api, let token else { return }
            snapshot = try await api.refresh(token: token)
        }
    }

    func complete(_ task: WatchTask) async {
        await perform(.completeTask(id: task.id))
    }

    func addTask(_ title: String) async {
        await perform(.createTask(title: title))
    }

    func log(_ habit: WatchHabit) async {
        guard let date = snapshot?.today else { return }
        await perform(.logHabit(id: habit.id, date: date, value: min(habit.goal, habit.value + 1)))
    }

    func startFocus(minutes: Int, task: String = "") async {
        await perform(.startTimer(minutes: minutes, task: task))
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
        await perform(.pauseTimer)
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["stride-focus"])
    }

    func disconnect() {
        CredentialStore.remove()
        snapshot = nil
        connected = false
        message = ""
    }

    private func perform(_ action: WatchAction) async {
        await run {
            guard let api, let token else { return }
            snapshot = try await api.perform(action, token: token)
        }
    }

    private func run(_ operation: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        message = ""
        defer { busy = false }
        do { try await operation() }
        catch {
            message = error.localizedDescription
            if case StoreError.server(let text) = error, text.contains("Pair this watch") {
                disconnect()
                message = text
            }
        }
    }
}
