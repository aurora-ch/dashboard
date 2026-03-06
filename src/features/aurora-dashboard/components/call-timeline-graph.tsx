// @ts-nocheck
import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useVAPICalls } from '@/hooks/use-vapi-calls'
import { type VAPICall } from '@/lib/vapi'
import { useTranslation } from '@/lib/translations'
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Phone, Wrench, UserPlus, Clock, MessageSquare, CheckCircle, XCircle } from 'lucide-react'
import { format } from 'date-fns'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { calculateSatisfactionScore } from '@/lib/satisfaction-score'
import { SatisfactionGauge } from '@/components/ui/satisfaction-gauge'

interface TimelineDataPoint {
  timestamp: number
  date: string
  calls: number
  successRate: number // 0-100 percentage
  toolCalls: number
  handoffs: number
  callList: VAPICall[] // Store actual calls for this bucket
}

interface ToolCallEvent {
  timestamp: number
  callId: string
  toolName: string
}

interface HandoffEvent {
  timestamp: number
  callId: string
}

/**
 * Estimate timestamp for a tool call within a call
 * Uses message position to estimate time within the call duration
 */
function estimateToolCallTimestamp(
  call: VAPICall,
  messageIndex: number,
  totalMessages: number
): number | null {
  const timestampStr = call.startedAt || call.createdAt
  if (!timestampStr) return null
  
  const startTime = new Date(timestampStr).getTime()
  if (isNaN(startTime)) return null
  
  const endTime = call.endedAt ? new Date(call.endedAt).getTime() : null
  
  // If we have an end time, distribute tool calls evenly across the call duration
  if (endTime) {
    const duration = endTime - startTime
    const progress = totalMessages > 0 ? messageIndex / totalMessages : 0.5
    return startTime + (duration * progress)
  }
  
  // If no end time, estimate based on average call duration (2 minutes)
  const estimatedDuration = call.duration ? call.duration * 1000 : 2 * 60 * 1000
  const progress = totalMessages > 0 ? messageIndex / totalMessages : 0.5
  return startTime + (estimatedDuration * progress)
}

/**
 * Extract tool call events from calls with estimated timestamps
 */
function extractToolCallEvents(calls: VAPICall[]): ToolCallEvent[] {
  const events: ToolCallEvent[] = []
  
  calls.forEach(call => {
    const allMessages = [
      ...(call.messages || []),
      ...(call.transcript || [])
    ]
    
    allMessages.forEach((msg, index) => {
      if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
        msg.toolCalls.forEach(tc => {
          if (tc?.function?.name) {
            const timestamp = estimateToolCallTimestamp(call, index, allMessages.length)
            if (timestamp) {
              events.push({
                timestamp,
                callId: call.id,
                toolName: tc.function.name
              })
            }
          }
        })
      }
    })
  })
  
  return events.sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Extract handoff events from calls
 */
function extractHandoffEvents(calls: VAPICall[]): HandoffEvent[] {
  const events: HandoffEvent[] = []
  
  calls.forEach(call => {
    const endedReason = call.endedReason || ''
    const isHandoff = 
      endedReason.includes('forward') ||
      endedReason.includes('transfer') ||
      endedReason === 'customer-transferred-call'
    
    if (isHandoff) {
      // Use endedAt if available, otherwise use startedAt/createdAt + duration
      let timestamp: number | null = null
      const startTimeStr = call.startedAt || call.createdAt
      
      if (call.endedAt) {
        timestamp = new Date(call.endedAt).getTime()
      } else if (startTimeStr && call.duration) {
        const startTime = new Date(startTimeStr).getTime()
        if (!isNaN(startTime)) {
          timestamp = startTime + (call.duration * 1000)
        }
      } else if (startTimeStr) {
        // Estimate 2 minutes if no duration
        const startTime = new Date(startTimeStr).getTime()
        if (!isNaN(startTime)) {
          timestamp = startTime + (2 * 60 * 1000)
        }
      }
      
      if (timestamp) {
        events.push({
          timestamp,
          callId: call.id
        })
      }
    }
  })
  
  return events.sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Group data points by time intervals (hourly or daily depending on data range)
 */
function groupDataByTime(
  calls: VAPICall[],
  toolCallEvents: ToolCallEvent[],
  handoffEvents: HandoffEvent[]
): TimelineDataPoint[] {
  if (calls.length === 0) return []
  
  // Determine time range - use startedAt first, fallback to createdAt
  const timestamps = calls
    .map(c => {
      const timestamp = c.startedAt || c.createdAt
      if (!timestamp) return null
      const time = new Date(timestamp).getTime()
      if (isNaN(time)) return null
      return time
    })
    .filter((t): t is number => t !== null)
  
  if (timestamps.length === 0) {
    console.warn('[groupDataByTime] No valid timestamps found in calls')
    return []
  }
  
  const minTime = Math.min(...timestamps)
  const maxTime = Math.max(...timestamps)
  const range = maxTime - minTime
  
  // Use hourly buckets if range is less than 7 days, otherwise daily
  const bucketSize = range < 7 * 24 * 60 * 60 * 1000 
    ? 60 * 60 * 1000 // 1 hour
    : 24 * 60 * 60 * 1000 // 1 day
  
  // Create buckets with success tracking and call storage
  const buckets = new Map<number, { 
    calls: number, 
    successful: number, 
    toolCalls: number, 
    handoffs: number,
    callList: VAPICall[]
  }>()
  
  // Count calls per bucket and determine success
  calls.forEach(call => {
    const timestampStr = call.startedAt || call.createdAt
    if (timestampStr) {
      const timestamp = new Date(timestampStr).getTime()
      if (isNaN(timestamp)) {
        console.warn('[groupDataByTime] Invalid timestamp for call:', call.id, timestampStr)
        return
      }
      const bucket = Math.floor(timestamp / bucketSize) * bucketSize
      
      const existing = buckets.get(bucket) || { calls: 0, successful: 0, toolCalls: 0, handoffs: 0, callList: [] }
      existing.calls++
      existing.callList.push(call)
      
      // A call is successful if it ended normally (not transferred, not failed)
      const endedReason = call.endedReason?.toLowerCase() || ''
      const isSuccessful = 
        call.status === 'ended' && 
        !endedReason.includes('transfer') && 
        !endedReason.includes('forward') &&
        !endedReason.includes('failed') &&
        !endedReason.includes('error')
      
      if (isSuccessful) {
        existing.successful++
      }
      
      buckets.set(bucket, existing)
    }
  })
  
  // Count tool calls per bucket
  toolCallEvents.forEach(event => {
    const bucket = Math.floor(event.timestamp / bucketSize) * bucketSize
    const existing = buckets.get(bucket) || { calls: 0, successful: 0, toolCalls: 0, handoffs: 0, callList: [] }
    existing.toolCalls++
    buckets.set(bucket, existing)
  })
  
  // Count handoffs per bucket
  handoffEvents.forEach(event => {
    const bucket = Math.floor(event.timestamp / bucketSize) * bucketSize
    const existing = buckets.get(bucket) || { calls: 0, successful: 0, toolCalls: 0, handoffs: 0, callList: [] }
    existing.handoffs++
    buckets.set(bucket, existing)
  })
  
  // Convert to array and sort, calculating success rate
  const dataPoints: TimelineDataPoint[] = Array.from(buckets.entries())
    .map(([timestamp, data]) => {
      // Calculate success rate as percentage (0-100)
      const successRate = data.calls > 0 
        ? Math.round((data.successful / data.calls) * 100)
        : 0
      
      return {
        timestamp,
        date: format(new Date(timestamp), range < 7 * 24 * 60 * 60 * 1000 ? 'MMM dd HH:mm' : 'MMM dd'),
        calls: data.calls,
        successRate,
        toolCalls: data.toolCalls,
        handoffs: data.handoffs,
        callList: data.callList
      }
    })
    .sort((a, b) => a.timestamp - b.timestamp)
  
  return dataPoints
}

export function CallTimelineGraph() {
  const { calls, loading } = useVAPICalls()
  const t = useTranslation()
  const [selectedBucket, setSelectedBucket] = useState<{ timestamp: number; calls: VAPICall[] } | null>(null)
  
  // ALL HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  const { timelineData, toolCallEvents, handoffEvents } = useMemo(() => {
    // Don't return empty if we have calls, even if loading
    if (calls.length === 0) {
      return { timelineData: [], toolCallEvents: [], handoffEvents: [] }
    }
    
    // Filter calls that have valid timestamps
    const validCalls = calls.filter(call => {
      return !!(call.startedAt || call.createdAt)
    })
    
    if (validCalls.length === 0) {
      if (import.meta.env.DEV) {
        console.warn('[CallTimelineGraph] No calls with valid timestamps')
      }
      return { timelineData: [], toolCallEvents: [], handoffEvents: [] }
    }
    
    const toolCalls = extractToolCallEvents(validCalls)
    const handoffs = extractHandoffEvents(validCalls)
    const timeline = groupDataByTime(validCalls, toolCalls, handoffs)
    
    return {
      timelineData: timeline,
      toolCallEvents: toolCalls,
      handoffEvents: handoffs
    }
  }, [calls, loading])
  
  // Use timeline buckets directly for the line chart - show number of calls
  // Also include tool calls and handoffs counts for each bucket
  // Memoize chart data to prevent unnecessary re-renders
  const chartData = useMemo(() => {
    return timelineData
      .filter(point => {
        // Ensure timestamp is valid
        return point.timestamp && !isNaN(point.timestamp)
      })
      .map(point => ({
        timestamp: point.timestamp,
        calls: point.calls,
        date: point.date,
        successRate: point.successRate, // Keep for tooltip
        toolCalls: point.toolCalls,
        handoffs: point.handoffs,
        hasToolCalls: point.toolCalls > 0,
        hasHandoffs: point.handoffs > 0,
        callList: point.callList // Include actual calls
      }))
  }, [timelineData])
  
  // Calculate total calls and max calls for Y-axis (memoized)
  const { totalCalls, maxCalls } = useMemo(() => {
    const total = timelineData.reduce((sum, p) => sum + p.calls, 0)
    const max = Math.max(...timelineData.map(p => p.calls), 0)
    
    return { totalCalls: total, maxCalls: max }
  }, [timelineData])
  
  // NOW we can do conditional returns after all hooks
  if (loading && calls.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            <Skeleton className="h-5 w-48" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    )
  }

  if (timelineData.length === 0 && calls.length > 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            {t.timeline?.title || 'Call Timeline'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>{t.timeline?.noData || 'No call data available for timeline'}</p>
            <p className="text-xs mt-2">Calls loaded: {calls.length}, but no valid timestamps found.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (timelineData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            {t.timeline?.title || 'Call Timeline'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>{t.timeline?.noData || 'No call data available for timeline'}</p>
          </div>
        </CardContent>
      </Card>
    )
  }
  
  if (chartData.length === 0) {
    if (import.meta.env.DEV) {
      console.error('[CallTimelineGraph] No valid chart data after filtering')
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            {t.timeline?.title || 'Call Timeline'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>{t.timeline?.noData || 'No call data available for timeline'}</p>
            <p className="text-xs mt-2">Timeline data points: {timelineData.length}, but none have valid timestamps.</p>
          </div>
        </CardContent>
      </Card>
    )
  }
  
  // Debug: Log data to help diagnose issues (only in development)
  if (import.meta.env.DEV && chartData.length > 0) {
    console.log('[CallTimelineGraph] Chart data prepared:', {
      dataPoints: chartData.length,
      sampleData: chartData.slice(0, 3),
      toolCalls: toolCallEvents.length,
      handoffs: handoffEvents.length,
      totalCalls,
      maxCalls,
      timelineDataRange: timelineData.length > 0 ? {
        first: new Date(timelineData[0].timestamp).toISOString(),
        last: new Date(timelineData[timelineData.length - 1].timestamp).toISOString()
      } : null
    })
  }
  
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            {t.timeline?.title || 'Call Timeline'}
          </CardTitle>
          <div className="text-right">
            <div className="text-2xl font-bold">{totalCalls}</div>
            <div className="text-xs text-muted-foreground">{t.timeline?.totalCalls || 'Total Calls'}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart
              data={chartData}
              margin={{ top: 20, right: 20, bottom: 60, left: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value) => {
                  if (!value || isNaN(value)) return ''
                  const date = new Date(value)
                  if (isNaN(date.getTime())) return ''
                  const range = timelineData.length > 0 
                    ? timelineData[timelineData.length - 1].timestamp - timelineData[0].timestamp
                    : 0
                  return range < 7 * 24 * 60 * 60 * 1000
                    ? format(date, 'HH:mm')
                    : format(date, 'MMM dd')
                }}
                label={{ value: t.timeline?.timeAxis || 'Time', position: 'insideBottom', offset: -5 }}
              />
              <YAxis
                label={{ value: t.timeline?.callsAxis || 'Number of Calls', angle: -90, position: 'insideLeft' }}
                domain={[0, 'auto']}
                allowDecimals={false}
                tickFormatter={(value) => `${value}`}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null
                  
                  const data = payload[0].payload
                  const date = new Date(data.timestamp)
                  const range = timelineData.length > 0 
                    ? timelineData[timelineData.length - 1].timestamp - timelineData[0].timestamp
                    : 0
                  
                  return (
                    <div className="bg-background border rounded-lg p-3 shadow-lg">
                      <p className="font-semibold mb-2">
                        {range < 7 * 24 * 60 * 60 * 1000
                          ? format(date, 'MMM dd, yyyy HH:mm')
                          : format(date, 'MMM dd, yyyy')}
                      </p>
                      <div className="space-y-1 text-sm">
                        <p className="font-semibold">
                          <Phone className="inline h-3 w-3 mr-1" />
                          {t.timeline?.calls || 'Calls'}: {data.calls || 0}
                        </p>
                        {data.successRate !== undefined && (
                          <p className="text-muted-foreground">
                            Success Rate: {data.successRate}%
                          </p>
                        )}
                        {/* Show tool calls and handoffs from the data point */}
                        {data.toolCalls > 0 && (
                          <p>
                            <Wrench className="inline h-3 w-3 mr-1" />
                            {t.timeline?.toolCalls || 'Tool Calls'}: {data.toolCalls}
                          </p>
                        )}
                        {data.handoffs > 0 && (
                          <p>
                            <UserPlus className="inline h-3 w-3 mr-1" />
                            {t.timeline?.handoffs || 'Handoffs'}: {data.handoffs}
                          </p>
                        )}
                        {data.callList && data.callList.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                            Click for detailed call information
                          </p>
                        )}
                      </div>
                    </div>
                  )
                }}
              />
              <Legend
                content={({ payload }) => (
                  <div className="flex justify-center gap-6 mt-4">
                    {payload?.map((entry, index) => (
                      <div key={index} className="flex items-center gap-2 text-sm">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span>{entry.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              />
              {/* Main line for number of calls with custom dots for tool calls and handoffs */}
              <Line
                type="monotone"
                dataKey="calls"
                stroke="#14b8a6"
                strokeWidth={2.5}
                name={t.timeline?.calls || 'Calls'}
                dot={(props: any) => {
                  const { cx, cy, payload } = props
                  if (cx === undefined || cy === undefined || isNaN(cx) || isNaN(cy)) return null
                  
                  // Show dots for all points that have calls
                  if (!payload.callList || payload.callList.length === 0) return null
                  
                  // Determine which dot to show (prioritize handoffs as they're more important)
                  if (payload.hasHandoffs) {
                    return (
                      <g>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={6}
                        fill="#ef4444"
                        stroke="#fff"
                        strokeWidth={2}
                        opacity={0.9}
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedBucket({ timestamp: payload.timestamp, calls: payload.callList || [] })
                          }}
                      />
                      </g>
                    )
                  }
                  
                  if (payload.hasToolCalls) {
                    return (
                      <g>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={5}
                        fill="#10b981"
                        stroke="#fff"
                        strokeWidth={1.5}
                        opacity={0.9}
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedBucket({ timestamp: payload.timestamp, calls: payload.callList || [] })
                          }}
                      />
                      </g>
                    )
                  }
                  
                  // Default dot for regular calls
                  return (
                    <g>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={4}
                        fill="#14b8a6"
                        stroke="#fff"
                        strokeWidth={1.5}
                        opacity={0.8}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedBucket({ timestamp: payload.timestamp, calls: payload.callList || [] })
                        }}
                      />
                    </g>
                  )
                }}
                activeDot={(props: any) => {
                  const { cx, cy, payload } = props
                  if (cx === undefined || cy === undefined || isNaN(cx) || isNaN(cy)) return null
                  
                  // Larger dot on hover - show based on tool calls/handoffs
                  if (payload.hasHandoffs) {
                    return (
                      <g>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={8}
                        fill="#ef4444"
                        stroke="#fff"
                        strokeWidth={2.5}
                        opacity={1}
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedBucket({ timestamp: payload.timestamp, calls: payload.callList || [] })
                          }}
                      />
                      </g>
                    )
                  }
                  
                  if (payload.hasToolCalls) {
                    return (
                      <g>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={7}
                        fill="#10b981"
                        stroke="#fff"
                        strokeWidth={2}
                        opacity={1}
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedBucket({ timestamp: payload.timestamp, calls: payload.callList || [] })
                          }}
                      />
                      </g>
                    )
                  }
                  
                  // Default active dot for regular points
                  return (
                    <g>
                    <circle
                      cx={cx}
                      cy={cy}
                        r={6}
                      fill="#14b8a6"
                      stroke="#fff"
                      strokeWidth={2}
                        opacity={0.9}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedBucket({ timestamp: payload.timestamp, calls: payload.callList || [] })
                        }}
                    />
                    </g>
                  )
                }}
                name="Call Success Rate"
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          
          {/* Legend */}
          <div className="flex justify-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#14b8a6' }} />
              <span>{t.timeline?.calls || 'Calls'}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span>{t.timeline?.toolCalls || 'Tool Calls'}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span>{t.timeline?.handoffs || 'Handoffs'}</span>
            </div>
          </div>
        </div>
      </CardContent>
      
      {/* Call Details Dialog */}
      <Dialog open={!!selectedBucket} onOpenChange={(open) => !open && setSelectedBucket(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] p-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle>
              Calls on {selectedBucket ? format(new Date(selectedBucket.timestamp), 'MMM dd, yyyy HH:mm') : ''}
            </DialogTitle>
            <DialogDescription>
              {selectedBucket?.calls.length || 0} call{(selectedBucket?.calls.length || 0) !== 1 ? 's' : ''} in this time period
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="p-4 space-y-4">
              {selectedBucket?.calls.map((call) => {
                // Extract tools used
                const allMessages = [...(call.messages || []), ...(call.transcript || [])]
                const toolsUsed = new Set<string>()
                allMessages.forEach((msg: any) => {
                  if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
                    msg.toolCalls.forEach((tc: any) => {
                      if (tc?.function?.name) {
                        toolsUsed.add(tc.function.name)
                      }
                    })
                  }
                })
                
                // Determine outcome
                const endedReason = call.endedReason?.toLowerCase() || ''
                const isTransferred = endedReason.includes('transfer') || endedReason.includes('forward')
                const outcome = isTransferred ? 'Transferred' : call.status === 'ended' ? 'Finished' : call.status || 'Unknown'
                
                // Calculate duration
                const duration = call.duration 
                  ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s`
                  : '-'
                
                // Get date
                const callDate = call.startedAt || call.createdAt
                const formattedDate = callDate ? format(new Date(callDate), 'MMM dd, yyyy HH:mm') : '-'
                
                // Get summary
                const summary = call.analysis?.summary || 'No summary available'
                
                // Calculate satisfaction score
                const satisfactionScore = calculateSatisfactionScore(call)
                
                return (
                  <div key={call.id} className="border rounded-lg p-4 space-y-3">
                    {/* Header with date and satisfaction */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{formattedDate}</span>
                      </div>
                      <SatisfactionGauge score={satisfactionScore} size={40} />
                    </div>
                    
                    {/* Duration and Outcome */}
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">Duration:</span>
                        <span className="font-medium">{duration}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {isTransferred ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        )}
                        <span className="font-medium">{outcome}</span>
                      </div>
                    </div>
                    
                    {/* Tools Used */}
                    {toolsUsed.size > 0 && (
                      <div className="flex items-start gap-2">
                        <Wrench className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div className="flex-1">
                          <span className="text-sm text-muted-foreground">Tools: </span>
                          <span className="text-sm font-medium">
                            {Array.from(toolsUsed).join(', ')}
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Summary */}
                    <div className="flex items-start gap-2">
                      <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div className="flex-1">
                        <span className="text-sm text-muted-foreground">Summary: </span>
                        <p className="text-sm mt-1">{summary}</p>
                      </div>
                    </div>
                    
                    {/* Satisfaction Score */}
                    <div className="flex items-center gap-2 pt-2 border-t">
                      <span className="text-sm text-muted-foreground">Satisfaction Rating:</span>
                      <span className="text-sm font-semibold">{satisfactionScore}/100</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

