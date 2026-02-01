import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const question = slug.split('-').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ')

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
          padding: '40px',
        }}
      >
        {/* Cute mini chat window */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: '1000px',
            background: colors.background,
            borderRadius: '24px',
            border: `2px solid ${colors.border}`,
            boxShadow: '0 20px 60px rgba(0,0,0,0.1), 0 8px 24px rgba(0,0,0,0.06)',
            overflow: 'hidden',
            transform: 'rotate(-0.5deg)',
          }}
        >
          {/* Lounge button inside container - circle like mobile */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              padding: '12px 16px 0 16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '9999px',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.9), rgba(217, 70, 239, 0.9))',
                color: '#ffffff',
                boxShadow: '0 4px 12px rgba(139, 92, 246, 0.25)',
              }}
            >
              <svg
                width="16"
                height="16"
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
              padding: '12px 24px 20px 24px',
              gap: '16px',
            }}
          >
            {/* Assistant Message with Vlad's photo */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'row-reverse',
                justifyContent: 'flex-end',
                alignItems: 'flex-start',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '16px 20px',
                  background: colors.secondary,
                  borderRadius: '18px',
                  maxWidth: '85%',
                }}
              >
                {/* Vlad's Image */}
                <img
                  src="https://vlad.chat/vlad.png"
                  width={90}
                  height={90}
                  style={{
                    borderRadius: '12px',
                  }}
                />
                <div
                  style={{
                    fontSize: '22px',
                    fontWeight: '400',
                    color: colors.foreground,
                    lineHeight: '1.3',
                  }}
                >
                  Hello, I am Vlad a software developer.
                </div>
                <div
                  style={{
                    fontSize: '22px',
                    fontWeight: '400',
                    color: colors.foreground,
                    lineHeight: '1.3',
                  }}
                >
                  Check out my shop or listen to some music.
                </div>
              </div>
            </div>

            {/* User Message - dynamic based on slug */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  padding: '14px 20px',
                  background: colors.primary,
                  color: colors.primaryForeground,
                  borderRadius: '16px',
                  fontSize: '22px',
                  fontWeight: '400',
                  lineHeight: '1.3',
                }}
              >
                {question}
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
                padding: '16px 20px',
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              <span
                style={{
                  color: colors.mutedForeground,
                  fontSize: '18px',
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
                padding: '8px 12px',
              }}
            >
              {/* Model Selector */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  color: colors.mutedForeground,
                  fontSize: '16px',
                  fontWeight: '500',
                }}
              >
                OpenCode
                <svg
                  width="16"
                  height="16"
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
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width="18"
                  height="18"
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
    { ...size }
  )
}
