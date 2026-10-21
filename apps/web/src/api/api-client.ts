import type {
  AuthTokens,
  AuthUser,
  InviteSummary,
  RoomListItem,
  RoomPermissions,
} from "@play/shared";

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

export interface RoomDetail {
  room: RoomListItem;
  role: RoomListItem["role"];
  permissions: RoomPermissions;
}

export class ApiClient {
  private accessToken: string | null = null;

  constructor(private readonly baseUrl: string) {}

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  getToken(): string | null {
    return this.accessToken;
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const body: ApiError =
        data && data.error
          ? data.error
          : { code: "INTERNAL_ERROR", message: "Error de red." };
      throw new ApiClientError(res.status, body);
    }
    return data as T;
  }

  register(input: { email: string; password: string; displayName: string }) {
    return this.request<{ user: AuthUser; tokens: AuthTokens }>("/api/auth/register", {
      method: "POST",
      body: input,
    });
  }

  login(input: { email: string; password: string }) {
    return this.request<{ user: AuthUser; tokens: AuthTokens }>("/api/auth/login", {
      method: "POST",
      body: input,
    });
  }

  refresh(refreshToken: string) {
    return this.request<{ user: AuthUser; tokens: AuthTokens }>("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    });
  }

  logout(refreshToken: string) {
    return this.request<{ ok: true }>("/api/auth/logout", {
      method: "POST",
      body: { refreshToken },
    });
  }

  listRooms() {
    return this.request<{ rooms: RoomListItem[] }>("/api/rooms");
  }

  createRoom(input: {
    name: string;
    privacyMode: string;
    controlMode: string;
    nonstopEnabled: boolean;
    repeatMode?: string;
    maxParticipants: number;
  }) {
    return this.request<{ room: RoomListItem }>("/api/rooms", {
      method: "POST",
      body: input,
    });
  }

  getRoom(roomId: string) {
    return this.request<RoomDetail>(`/api/rooms/${roomId}`);
  }

  updateRoom(roomId: string, input: Record<string, unknown>) {
    return this.request<{ room: RoomListItem }>(`/api/rooms/${roomId}`, {
      method: "PATCH",
      body: input,
    });
  }

  closeRoom(roomId: string) {
    return this.request<{ ok: true }>(`/api/rooms/${roomId}/close`, { method: "POST" });
  }

  deleteRoom(roomId: string) {
    return this.request<{ ok: true }>(`/api/rooms/${roomId}`, { method: "DELETE" });
  }

  createInvite(roomId: string) {
    return this.request<{ invite: InviteSummary }>(`/api/rooms/${roomId}/invites`, {
      method: "POST",
    });
  }

  listInvites(roomId: string) {
    return this.request<{ invites: InviteSummary[] }>(`/api/rooms/${roomId}/invites`);
  }

  revokeInvite(roomId: string, inviteId: string) {
    return this.request<{ ok: true }>(
      `/api/rooms/${roomId}/invites/${inviteId}/revoke`,
      { method: "POST" },
    );
  }

  previewInvite(token: string) {
    return this.request<{ valid: true; roomId: string }>(`/api/invites/${token}`);
  }

  joinByInvite(token: string) {
    return this.request<{ roomId: string; role: string }>(`/api/invites/${token}/join`, {
      method: "POST",
    });
  }

  setMemberRole(roomId: string, userId: string, role: string) {
    return this.request<{ ok: true }>(`/api/rooms/${roomId}/members/${userId}/role`, {
      method: "POST",
      body: { role },
    });
  }

  removeMember(roomId: string, userId: string) {
    return this.request<{ ok: true }>(`/api/rooms/${roomId}/members/${userId}`, {
      method: "DELETE",
    });
  }
}
