import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  // Colors extracted from globals.css (light mode)
  const colors = {
    background: '#ffffff',
    foreground: '#1a1a1a',
    primary: '#2b2b2b',
    primaryForeground: '#fafafa',
    secondary: '#f5f5f5',
    secondaryForeground: '#2b2b2b',
    muted: '#f5f5f5',
    mutedForeground: '#737373',
    border: '#e5e5e5',
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(145deg, #fafafa 0%, #f0f0f0 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Cute mini chat window */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '780px',
            background: colors.background,
            borderRadius: '32px',
            border: `3px solid ${colors.border}`,
            boxShadow: '0 30px 80px rgba(0,0,0,0.12), 0 12px 30px rgba(0,0,0,0.08)',
            overflow: 'hidden',
            transform: 'rotate(-1deg)',
          }}
        >
          {/* Lounge button inside container - circle like mobile */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              padding: '16px 20px 0 20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '36px',
                height: '36px',
                borderRadius: '9999px',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.9), rgba(217, 70, 239, 0.9))',
                color: '#ffffff',
                boxShadow: '0 4px 12px rgba(139, 92, 246, 0.25)',
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
              </svg>
            </div>
          </div>

          {/* Messages */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: '16px 32px 32px 32px',
              gap: '24px',
            }}
          >
            {/* Assistant Message with Vlad's photo */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'row-reverse',
                justifyContent: 'flex-end',
                alignItems: 'flex-start',
                gap: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  padding: '24px 28px',
                  background: colors.secondary,
                  borderRadius: '24px',
                  maxWidth: '85%',
                }}
              >
                {/* Vlad's Image */}
                <img
                  src="https://vlad.chat/vlad.png"
                  width={110}
                  height={110}
                  style={{
                    borderRadius: '16px',
                  }}
                />
                <div
                  style={{
                    fontSize: '26px',
                    fontWeight: '400',
                    color: colors.foreground,
                    lineHeight: '1.35',
                  }}
                >
                  Hello, I am Vlad a software developer.
                </div>
                <div
                  style={{
                    fontSize: '26px',
                    fontWeight: '400',
                    color: colors.foreground,
                    lineHeight: '1.35',
                  }}
                >
                  Check out my shop or listen to some music.
                </div>
              </div>
            </div>

            {/* User Message */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  padding: '16px 22px',
                  background: colors.primary,
                  color: colors.primaryForeground,
                  borderRadius: '18px',
                  fontSize: '26px',
                  fontWeight: '400',
                  lineHeight: '1.35',
                }}
              >
                What are your latest updates?
              </div>
            </div>
          </div>

          {/* Input Area */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              borderTop: `1px solid ${colors.border}`,
            }}
          >
            {/* Textarea */}
            <div
              style={{
                display: 'flex',
                padding: '24px 28px',
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              <span
                style={{
                  color: colors.mutedForeground,
                  fontSize: '22px',
                }}
              >
                What would you like to know?
              </span>
            </div>
            {/* Toolbar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
              }}
            >
              {/* Model Selector */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  color: colors.mutedForeground,
                  fontSize: '18px',
                  fontWeight: '500',
                }}
              >
                OpenCode
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              {/* Submit Button */}
              <div
                style={{
                  display: 'flex',
                  width: '44px',
                  height: '44px',
                  borderRadius: '10px',
                  background: colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={colors.primaryForeground}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </div>
            </div>
          </div>
        </div>

      </div>
    ),
    size
  )
}
