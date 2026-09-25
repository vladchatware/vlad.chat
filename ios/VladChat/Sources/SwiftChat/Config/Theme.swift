//
//  Theme.swift
//  SwiftChat
//
//  Created on 03/25/26.
//  Copyright © 2026 Sacha Servan-Schreiber. All rights reserved.
//

import SwiftUI

/// Centralized theme and design system for the app
enum Theme {

    // MARK: - Colors
    enum Colors {
        static let backgroundPrimary = Color.backgroundPrimary
        static let chatSurfaceDark = Color.chatSurfaceDark
        static let chatSurfaceLight = Color.chatSurfaceLight
        static let sidebarButtonDark = Color.sidebarButtonBackgroundDark
        static let sidebarButtonLight = Color.sidebarButtonBackgroundLight
        static let cardSurfaceDark = Color.cardSurfaceDark
        static let cardSurfaceLight = Color.cardSurfaceLight
        static let chatBackgroundDark = Color.chatBackgroundDark
        static let chatBackgroundLight = Color.chatBackgroundLight
        static let sidebarBackgroundDark = Color.sidebarBackgroundDark
        static let sidebarBackgroundLight = Color.sidebarBackgroundLight
        static let settingsBackgroundDark = Color.settingsBackgroundDark
        static let settingsBackgroundLight = Color.settingsBackgroundLight
    }

    // MARK: - Dimensions
    enum Dimensions {
        // Layout
        static let sidebarWidth: CGFloat = 300

        // Common padding values used throughout the app
        static let paddingExtraSmall: CGFloat = 4
        static let paddingSmall: CGFloat = 8
        static let paddingMedium: CGFloat = 12
        static let paddingLarge: CGFloat = 16
        static let paddingExtraLarge: CGFloat = 24

        // Layout roles. Components should use these names instead of inventing
        // a second spacing scale for equivalent content.
        static let transcriptGutter: CGFloat = 16
        /// Vertical rhythm between consecutive messages — looser, Grok-like trail.
        static let messageGroupSpacing: CGFloat = 28
        static let responseSectionSpacing: CGFloat = 12
        static let relatedItemSpacing: CGFloat = 8
        static let compactItemSpacing: CGFloat = 4
        static let controlLabelSpacing: CGFloat = 6
        static let controlHitTarget: CGFloat = 44
        static let bottomFollowTolerance: CGFloat = 24

        // Common corner radius values
        static let cornerRadiusSmall: CGFloat = 8
        static let cornerRadiusMedium: CGFloat = 12
        static let cornerRadiusLarge: CGFloat = 16
        /// User bubble — slightly rounder than activity cards.
        static let bubbleCornerRadius: CGFloat = 18
        /// Tool / search / computer-use cards share this radius.
        static let activityCardCornerRadius: CGFloat = 14
        /// Floating composer capsule.
        static let composerCornerRadius: CGFloat = 26
        /// Max width fraction for user bubbles (assistant stays full gutter).
        static let userBubbleMaxWidthFraction: CGFloat = 0.78
    }

    // MARK: - Typography
    enum Typography {
        static let activityTitle = Font.system(size: 13, weight: .semibold)
        static let activitySecondary = Font.system(size: 12, weight: .regular)
        static let caption = Font.system(size: 11, weight: .medium)
        static let thinkingLabel = Font.system(size: 15, weight: .medium)
        static let composerBody = Font.system(.body)
    }

    // MARK: - Animations
    enum Animations {
        // Common animation durations
        static let defaultDuration: Double = 0.25
        static let mediumDuration: Double = 0.3
        static let longDuration: Double = 0.6
        static let copyFeedbackDuration: Double = 1.5
        /// Shimmer sweep target (matches web ~1.5s).
        static let shimmerDuration: Double = 1.5

        // Spring animations used in various places
        static let springResponse: Double = 0.3
        static let springDamping: Double = 0.75
        static let springResponseFast: Double = 0.2
        static let springDampingHigh: Double = 0.9
    }
}
