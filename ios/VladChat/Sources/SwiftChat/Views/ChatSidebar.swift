//
//  ChatSidebar.swift
//  SwiftChat
//
//  Created on 03/25/26.
//  Copyright © 2026 Sacha Servan-Schreiber. All rights reserved.
//

import SwiftUI

struct ChatSidebar: View {
    @Binding var selection: String?
    @ObservedObject var viewModel: ChatViewModel

    @State private var chatToRename: Chat?
    @State private var renameTitle = ""
    @State private var chatToDelete: Chat?

    var body: some View {
        VStack(spacing: 0) {
            List(selection: $selection) {
                if viewModel.chats.isEmpty {
                    ContentUnavailableView(
                        "No Chats Yet",
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text("Start a new chat to see it here.")
                    )
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(chatGroups) { group in
                        Section(group.title) {
                            ForEach(group.chats) { chat in
                                ChatSidebarRow(chat: chat)
                                    .tag(Optional(chat.id))
                                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                        if !chat.isBlankChat {
                                            Button("Delete", systemImage: "trash", role: .destructive) {
                                                chatToDelete = chat
                                            }

                                            Button("Rename", systemImage: "pencil") {
                                                renameTitle = chat.title
                                                chatToRename = chat
                                            }
                                            .tint(.indigo)
                                        }
                                    }
                                    .contextMenu {
                                        if !chat.isBlankChat {
                                            Button("Rename", systemImage: "pencil") {
                                                renameTitle = chat.title
                                                chatToRename = chat
                                            }
                                            Button("Delete", systemImage: "trash", role: .destructive) {
                                                chatToDelete = chat
                                            }
                                        }
                                    }
                            }
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Chats")
        .navigationBarTitleDisplayMode(.large)
        .tint(.primary)
        .applySystemGlassToolbarIfAvailable()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: createChat) {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel("New chat")
                .accessibilityIdentifier("newChat")
            }
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .alert("Rename Chat", isPresented: renameAlertIsPresented) {
            TextField("Chat name", text: $renameTitle)
            Button("Cancel", role: .cancel) { chatToRename = nil }
            Button("Save") {
                if let chatToRename {
                    viewModel.updateChatTitle(chatToRename.id, newTitle: renameTitle)
                }
                chatToRename = nil
            }
        } message: {
            Text("Choose a name for this chat.")
        }
        .alert("Delete Chat?", isPresented: deleteAlertIsPresented) {
            Button("Cancel", role: .cancel) { chatToDelete = nil }
            Button("Delete", role: .destructive) {
                if let chatToDelete {
                    viewModel.deleteChat(chatToDelete.id)
                }
                chatToDelete = nil
                if viewModel.chats.isEmpty {
                    viewModel.createNewChat()
                }
            }
        } message: {
            Text("This chat will be deleted from your history.")
        }
    }

    private var chatGroups: [ChatGroup] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today) ?? today
        let weekAgo = calendar.date(byAdding: .day, value: -7, to: today) ?? yesterday
        let sortedChats = viewModel.chats.sorted { $0.createdAt > $1.createdAt }

        return [
            ChatGroup(title: "Today", chats: sortedChats.filter { $0.createdAt >= today }),
            ChatGroup(title: "Yesterday", chats: sortedChats.filter { $0.createdAt >= yesterday && $0.createdAt < today }),
            ChatGroup(title: "Previous 7 Days", chats: sortedChats.filter { $0.createdAt >= weekAgo && $0.createdAt < yesterday }),
            ChatGroup(title: "Earlier", chats: sortedChats.filter { $0.createdAt < weekAgo }),
        ].filter { !$0.chats.isEmpty }
    }

    private func createChat() {
        viewModel.createNewChat()
    }

    private var renameAlertIsPresented: Binding<Bool> {
        Binding(
            get: { chatToRename != nil },
            set: { if !$0 { chatToRename = nil } }
        )
    }

    private var deleteAlertIsPresented: Binding<Bool> {
        Binding(
            get: { chatToDelete != nil },
            set: { if !$0 { chatToDelete = nil } }
        )
    }
}

private struct ChatGroup: Identifiable {
    let title: String
    let chats: [Chat]

    var id: String { title }
}

private struct ChatSidebarRow: View {
    let chat: Chat

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(displayTitle)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)

                Spacer(minLength: 0)

                if !chat.isBlankChat {
                    Text(chat.createdAt.formatted(
                        .relative(presentation: .numeric, unitsStyle: .abbreviated)
                    ))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                }
            }

            Text(preview)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var displayTitle: String {
        chat.isBlankChat || chat.title == Chat.placeholderTitle ? "New chat" : chat.title
    }

    private var preview: String {
        guard let latestMessage = chat.messages.last else { return "No messages yet" }
        let content = latestMessage.content.trimmingCharacters(in: .whitespacesAndNewlines)
        return content.isEmpty ? "Conversation" : content
    }
}
