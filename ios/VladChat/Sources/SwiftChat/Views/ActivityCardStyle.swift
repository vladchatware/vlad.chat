//
//  ActivityCardStyle.swift
//  VladChat
//
//  Shared chrome for tool / search / computer-use cards so they read as
//  first-class transcript furniture instead of bolted-on boxes.
//

import SwiftUI

enum ActivityCardStyle {
    static func fill(isDarkMode: Bool) -> Color {
        Color.toolCardBackground(isDarkMode: isDarkMode)
    }

    static func stroke(isDarkMode: Bool) -> Color {
        Color.toolCardStroke(isDarkMode: isDarkMode)
    }

    static var cornerRadius: CGFloat {
        Theme.Dimensions.activityCardCornerRadius
    }
}

/// Soft bordered surface used by tool rows, search boxes, and computer-use cards.
struct ActivityCardBackground: ViewModifier {
    let isDarkMode: Bool
    var emphasized = false

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, Theme.Dimensions.paddingMedium)
            .padding(.vertical, Theme.Dimensions.paddingSmall + 2)
            .background(
                RoundedRectangle(cornerRadius: ActivityCardStyle.cornerRadius, style: .continuous)
                    .fill(ActivityCardStyle.fill(isDarkMode: isDarkMode))
            )
            .overlay(
                RoundedRectangle(cornerRadius: ActivityCardStyle.cornerRadius, style: .continuous)
                    .strokeBorder(
                        emphasized
                            ? Color.orange.opacity(isDarkMode ? 0.45 : 0.35)
                            : ActivityCardStyle.stroke(isDarkMode: isDarkMode),
                        lineWidth: 1
                    )
            )
    }
}

extension View {
    func activityCard(isDarkMode: Bool, emphasized: Bool = false) -> some View {
        modifier(ActivityCardBackground(isDarkMode: isDarkMode, emphasized: emphasized))
    }
}
