//
//  AppConfig.swift
//  SwiftChat
//
//  Created on 03/25/26.
//  Copyright © 2026 Sacha Servan-Schreiber. All rights reserved.
//

import Foundation
import Combine

/// A model available for chat
struct ModelType: Identifiable, Codable, Hashable, Equatable {
    let id: String
    let displayName: String
    let fullName: String
    let iconName: String
    let isMultimodal: Bool

    var modelName: String { id }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    static func == (lhs: ModelType, rhs: ModelType) -> Bool { lhs.id == rhs.id }
}

/// Application-wide configuration
@MainActor
class AppConfig: ObservableObject {
    static let shared = AppConfig()

    // MARK: - State

    @Published private(set) var isInitialized = false
    @Published private(set) var initializationError: Error?
    @Published var currentModel: ModelType? {
        didSet {
            if let model = currentModel {
                UserDefaults.standard.set(model.id, forKey: "selectedModel")
            }
        }
    }
    @Published private(set) var availableModels: [ModelType] = []
    @Published private(set) var networkMonitor = NetworkMonitor()

    private init() {
        setupDefaultModels()
        loadLastSelectedModel()
        isInitialized = true
    }

    // MARK: - Models

    /// Override this to change available models
    private func setupDefaultModels() {
        availableModels = [
            ModelType(id: "zai/glm-5.3-flash", displayName: "GLM 5.3 Flash", fullName: "GLM 5.3 Flash", iconName: "openai-icon", isMultimodal: false),
            ModelType(id: "anthropic/claude-opus-5.5", displayName: "Opus 5.5", fullName: "Claude Opus 5.5", iconName: "openai-icon", isMultimodal: false),
            ModelType(id: "openai/gpt-5.6-luna", displayName: "GPT 5.6 Luna", fullName: "GPT 5.6 Luna", iconName: "openai-icon", isMultimodal: false),
            ModelType(id: "spacexai/grok-4.7", displayName: "Grok 4.7", fullName: "Grok 4.7", iconName: "openai-icon", isMultimodal: false),
            ModelType(id: "deepseek/deepseek-v4.1-flash", displayName: "DeepSeek 4.1", fullName: "DeepSeek 4.1", iconName: "openai-icon", isMultimodal: false),
        ]
    }

    private func loadLastSelectedModel() {
        if let savedId = UserDefaults.standard.string(forKey: "selectedModel"),
           let model = availableModels.first(where: { $0.id == savedId }) {
            currentModel = model
        } else {
            currentModel = availableModels.first
        }
    }

    func filteredModelTypes() -> [ModelType] {
        return availableModels
    }

    /// The model used for generating chat titles (nil = skip title generation)
    var titleModel: ModelType? {
        availableModels.first(where: { $0.id == "gpt-4.1-mini" }) ?? availableModels.first
    }
}
