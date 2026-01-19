import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#f5f5f5',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
          padding: '0 60px',
        }}
      >
        <div
          style={{
            fontSize: '90px',
            fontWeight: '700',
            color: '#333',
            textAlign: 'center',
            marginBottom: '20px',
          }}
        >
          Chat with Vlad
        </div>
        <div
          style={{
            fontSize: '36px',
            fontWeight: '400',
            color: '#666',
            textAlign: 'center',
          }}
        >
          Ask me anything • Expert insights
        </div>
      </div>
    ),
    size
  )
}
