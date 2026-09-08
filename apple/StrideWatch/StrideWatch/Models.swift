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
    var tasks: [WatchTask]
    var habits: [WatchHabit]
    var timer: WatchTimer?
}

struct PairingResponse: Decodable {
    let token: String
    let expires: String
}

struct ErrorResponse: Decodable {
    let error: String
}

struct EmptyResponse: Encodable {}

enum WatchAction: Codable {
    case createTask(id: String, title: String)
    case completeTask(id: String)
    case logHabit(id: String, date: String, value: Double)
    case startTimer(minutes: Int, task: String, startedAt: Double)
    case pauseTimer(remaining: Double)

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: Keys.self)
        switch self {
        case .createTask(let id, let title):
            try values.encode("createTask", forKey: .action)
            try values.encode(id, forKey: .id)
            try values.encode(title, forKey: .title)
        case .completeTask(let id):
            try values.encode("completeTask", forKey: .action)
            try values.encode(id, forKey: .taskId)
        case .logHabit(let id, let date, let value):
            try values.encode("logHabit", forKey: .action)
            try values.encode(id, forKey: .habitId)
            try values.encode(date, forKey: .date)
            try values.encode(value, forKey: .value)
        case .startTimer(let minutes, let task, let startedAt):
            try values.encode("startTimer", forKey: .action)
            try values.encode(minutes, forKey: .minutes)
            try values.encode(task, forKey: .taskId)
            try values.encode(startedAt, forKey: .startedAt)
        case .pauseTimer(let remaining):
            try values.encode("pauseTimer", forKey: .action)
            try values.encode(remaining, forKey: .remaining)
        }
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: Keys.self)
        switch try values.decode(String.self, forKey: .action) {
        case "createTask":
            self = .createTask(
                id: try values.decode(String.self, forKey: .id),
                title: try values.decode(String.self, forKey: .title)
            )
        case "completeTask":
            self = .completeTask(id: try values.decode(String.self, forKey: .taskId))
        case "logHabit":
            self = .logHabit(
                id: try values.decode(String.self, forKey: .habitId),
                date: try values.decode(String.self, forKey: .date),
                value: try values.decode(Double.self, forKey: .value)
            )
        case "startTimer":
            self = .startTimer(
                minutes: try values.decode(Int.self, forKey: .minutes),
                task: try values.decode(String.self, forKey: .taskId),
                startedAt: try values.decode(Double.self, forKey: .startedAt)
            )
        case "pauseTimer":
            self = .pauseTimer(remaining: try values.decode(Double.self, forKey: .remaining))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .action,
                in: values,
                debugDescription: "Unknown Watch action"
            )
        }
    }

    private enum Keys: String, CodingKey {
        case action, id, title, taskId, habitId, date, value, minutes, startedAt, remaining
    }
}
