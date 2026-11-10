// components/learning/room/types.ts — the room as /api/lms/room/<id> sends it (lib/lms/room.ts).

export interface RoomMsg {
  id: string; kind: 'CHAT' | 'QUESTION'; body: string; author: string; anonymous: boolean; is_host: boolean
  upvotes: number; answered_at: string | null; answer: string | null; hidden: boolean; created_at: string; mine: boolean
}

export interface RoomPoll {
  id: string; question: string; options: string[]; status: 'OPEN' | 'CLOSED'; show_results: boolean; created_at: string
  counts: number[] | null; total: number | null; my_vote: number | null
}

export type RoomPhase = 'cancelled' | 'before' | 'live' | 'ended'

export interface RoomFlags {
  phase: RoomPhase; live_started_at: string | null; live_ended_at: string | null
  room_chat: boolean; room_questions: boolean; pinned_message_id: string | null
}

export interface RoomData {
  session: RoomFlags & {
    id: string; title: string; description: string | null; host_name: string | null; starts_at: string; ends_at: string; duration_min: number
    status: string; course_title: string | null; stream_kind: 'MEETING' | 'YOUTUBE' | 'VIMEO' | 'HLS'; has_link: boolean; location: string | null; has_recording: boolean
  }
  stage: { kind: 'YOUTUBE' | 'VIMEO' | 'HLS'; src: string } | null
  host_join_url: string | null
  checkin_code: string | null
  me: { name: string; host: boolean; learner: boolean; read_only: boolean; can_post: boolean; attended: boolean; attendance_by: string | null; room_seconds: number; need_s: number }
  topic: string
  viewers: number
  chat: RoomMsg[]
  questions: RoomMsg[]
  my_votes: string[]
  polls: RoomPoll[]
  pinned: RoomMsg | null
  server_now: string
}
