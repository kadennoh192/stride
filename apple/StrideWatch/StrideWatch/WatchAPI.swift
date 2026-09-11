import Foundation

actor WatchAPI {
    private let origin: URL
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init() throws {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "STRIDE_API_ORIGIN") as? String,
              let url = URL(string: value),
              url.scheme == "https",
              url.path.isEmpty || url.path == "/"
        else { throw StoreError.invalidOrigin }
        origin = url
    }

    func pair(code: String) async throws -> PairingResponse {
        try await request(
            path: "/api/watch/pair",
            token: nil,
            body: ["action": "redeem", "code": code.uppercased()],
            as: PairingResponse.self
        )
    }

    func refresh(token: String) async throws -> WatchSnapshot {
        try await request(path: "/api/watch", token: token, body: Optional<EmptyResponse>.none, as: WatchSnapshot.self)
    }

    func perform(_ action: WatchAction, token: String) async throws -> WatchSnapshot {
        try await request(path: "/api/watch", token: token, body: action, as: WatchSnapshot.self)
    }

    private func request<Body: Encodable, Output: Decodable>(
        path: String,
        token: String?,
        body: Body?,
        as output: Output.Type
    ) async throws -> Output {
        guard let url = URL(string: path, relativeTo: origin) else { throw StoreError.invalidOrigin }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 20
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
        }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw StoreError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? decoder.decode(ErrorResponse.self, from: data).error)
                ?? "Stride is temporarily unavailable."
            throw StoreError.server(status: http.statusCode, message: message)
        }
        do { return try decoder.decode(Output.self, from: data) }
        catch { throw StoreError.invalidResponse }
    }
}
