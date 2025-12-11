# Changelog

All notable changes to vlad.chat will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-07-15

### 🚀 Features

- **Initial Release**: First public release of vlad.chat with core functionality
- **AI-Powered Chat**: Interactive conversations using OpenAI GPT-5 models
- **Notion Integration**: Access to knowledge base stored in Notion pages
- **Payment Processing**: Stripe integration for credit-based usage
- **Analytics**: PostHog integration for usage tracking
- **Authentication**: Anonymous and Google OAuth authentication via Convex Auth
- **Modern UI**: Beautiful, responsive interface built with Radix UI and Tailwind CSS
- **Streaming Responses**: Real-time streaming of AI responses
- **Reasoning Display**: Optional reasoning chain visualization
- **Lounge Chat**: Community chat feature with motion animations
- **Style Guide**: Comprehensive component documentation and examples

### 🎨 UI/UX Improvements

- **Motion Animations**: Implemented motion animations for lounge chat background, header, messages, and interactive elements
- **Shimmer & Loader**: Integrated Shimmer and Loader components for enhanced loading indicators
- **Theme Provider**: Added theme context/state management for dark/light mode support
- **UI Components**: Added carousel, collapsible, dropdown menu, hover card, progress, scroll area, select, separator, tooltip components
- **Enhanced Messaging**: Updated trial message display and sign-in prompt for better clarity and engagement

### 🐛 Bug Fixes

- **Recursive Fetching**: Fixed recursive fetching of nested child blocks in convertBlocksToMarkdown
- **Message Expiration**: Updated lounge chat message expiration time from midnight to 3 AM UTC
- **Error Handling**: Commented out error handling suggestions in ChatBotDemo to prevent rendering issues
- **MCP URL Configuration**: Updated MCP URL to use environment variable for improved configuration management

### 🔧 Technical Improvements

- **Next.js 15 & React 19**: Upgraded to latest versions for improved compatibility and features
- **TypeScript Configuration**: Updated TypeScript configuration for better type safety
- **Dependency Updates**: Updated all dependencies to latest stable versions
- **Performance**: Implemented paginated message loading in LoungeChat
- **Mobile Responsiveness**: Updated time display in LoungeChat for better mobile experience
- **New Messages Indicator**: Added new messages indicator and scroll to bottom button

### 📚 Documentation

- **Comprehensive README**: Complete setup, configuration, and deployment guide
- **Style Guide**: Added StyleguidePage component showcasing AI elements and their usage
- **Project Structure**: Clear documentation of the codebase organization

### 🔄 Refactoring

- **Streamlined AI Identity**: Centralized base identity and updated lounge chat response style
- **Code Cleanup**: Removed unused CSS and streamlined component organization

## [Unreleased]

### 🚀 Features

- **Upcoming Features**: Placeholder for future releases

### 🐛 Bug Fixes

- **Known Issues**: Placeholder for bug fixes in next release

### 🔧 Technical Improvements

- **Performance Optimizations**: Placeholder for performance improvements

---

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md with new release notes
3. Create git tag: `git tag vX.X.X`
4. Push tag to remote: `git push origin vX.X.X`
5. Build and deploy: `bun run build`

## Versioning

- **MAJOR**: Breaking changes, significant new features
- **MINOR**: Backwards-compatible new features
- **PATCH**: Backwards-compatible bug fixes
