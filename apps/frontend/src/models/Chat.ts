export interface IChat {
  id?: number;
  usersOrTitle: string;
  isGroup: boolean;
  groupUsers?: {
    name: string;
  }[];
  unreadCount?: number;
  messages: {
    text: string;
    isReaded: boolean;
    timestamp: string;
    isInterlocutor: boolean;
  }[];
  lastVisit?: string;
  isOnline?: boolean;
}

export interface IAlert {
  id?: number;
  usersOrTitle: string;
  isGroup: boolean;
  groupUsers?: {
    name: string;
  }[];
  messages: { text: string; timestamp: string }[];
  isOnline?: boolean;
}

export interface IMessage {
  text: string | JSX.Element;
  timestamp: string;
  isReaded?: boolean;
  isInterlocutor?: boolean;
  author?: string;
  isLink?: boolean;
}
