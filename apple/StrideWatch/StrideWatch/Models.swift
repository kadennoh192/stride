import Foundation

struct WatchTask: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let due: String
    let time: String
    let priority: Int
    let tags: [String]
    let project: String
}

struct WatchHabit: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let icon: String
    let goal: Double
    let unit: String
    let value: Double
}

struct WatchTimer: Codable, Hashable {
    let id: String
    let phase: String
    let duration: Double
    let remaining: Double
    let end: Double
    let running: Bool
    let cycle: Int
    let task: String

    var endDate: Date { Date(timeIntervalSince1970: end / 1_000) }
}

struct WatchSnapshot: Codable {
    let version: Int
    let serverTime: String
    let today: String
    let timezone: String
    let tasks: [WatchTask]
    let habits: [WatchHabit]
    let timer: WatchTimer?
}

struct PairingResponse: Decodable {
    let token: String
    let expires: String
}

struct ErrorResponse: Decodable {
    let error: String
}

struct EmptyResponse: Encodable {}

enum WatchAction: Encodable {
    case createTask(title: String)
    case completeTask(id: String)
    case logHabit(id: String, date: String, value: Double)
    case startTimer(minutes: Int, task: String)
    case pauseTimer

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: Keys.self)
        switch self {
        case .createTask(let title):
            try values.encode("createTask", forKey: .action)
            try values.encode(title, forKey: .title)
        case .completeTask(let id):
            try values.encode("completeTask", forKey: .action)
            try values.encode(id, forKey: .taskId)
        case .logHabit(let id, let date, let value):
            try values.encode("logHabit", forKey: .action)
            try values.encode(id, forKey: .habitId)
            try values.encode(date, forKey: .date)
            try values.encode(value, forKey: .value)
        case .startTimer(let minutes, let task):
            try values.encode("startTimer", forKey: .action)
            try values.encode(minutes, forKey: .minutes)
            try values.encode(task, forKey: .taskId)
        case .pauseTimer:
            try values.encode("pauseTimer", forKey: .action)
        }
    }

    private enum Keys: String, CodingKey {
        case action, title, taskId, habitId, date, value, minutes
    }
}
