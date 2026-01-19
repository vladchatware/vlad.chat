import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const capitalizedSlug = slug.split('-').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ')
  
  const title = `What Vlad knows about ${capitalizedSlug}`

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
            fontSize: '56px',
            fontWeight: '700',
            color: '#333',
            textAlign: 'center',
            marginBottom: '20px',
            lineHeight: '1.3',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: '32px',
            fontWeight: '400',
            color: '#666',
            textAlign: 'center',
          }}
        >
          Expert insights • Ask me anything
        </div>
      </div>
    ),
    { ...size }
  )
}
