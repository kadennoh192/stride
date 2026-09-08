import Foundation

enum OfflineStore {
    private static let snapshotKey = "cached-workspace-v1"
    private static let queueKey = "pending-actions-v1"
    private static let encoder = JSONEncoder()
    private static let decoder = JSONDecoder()

    static func snapshot() -> WatchSnapshot? {
        guard let data = UserDefaults.standard.data(forKey: snapshotKey) else { return nil }
        return try? decoder.decode(WatchSnapshot.self, from: data)
    }

    static func save(snapshot: WatchSnapshot?) {
        guard let snapshot, let data = try? encoder.encode(snapshot) else {
            UserDefaults.standard.removeObject(forKey: snapshotKey)
            return
        }
        UserDefaults.standard.set(data, forKey: snapshotKey)
    }

    static func queue() -> [WatchAction] {
        guard let data = UserDefaults.standard.data(forKey: queueKey) else { return [] }
        return (try? decoder.decode([WatchAction].self, from: data)) ?? []
    }

    static func save(queue: [WatchAction]) {
        guard !queue.isEmpty, let data = try? encoder.encode(Array(queue.suffix(100))) else {
            UserDefaults.standard.removeObject(forKey: queueKey)
            return
        }
        UserDefaults.standard.set(data, forKey: queueKey)
    }

    static func removeAll() {
        UserDefaults.standard.removeObject(forKey: snapshotKey)
        UserDefaults.standard.removeObject(forKey: queueKey)
    }
}
