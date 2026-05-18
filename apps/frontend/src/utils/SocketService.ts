import { Socket, io } from 'socket.io-client';
import { RADPAIR_URL } from '../redux/reducers/radpairReducer';
import { IReportCreate, IReportUpdate } from '../redux/types/radpaidTypes';

class SocketService {
  private _socket: Socket | null;

  constructor() {
    this._socket = null;
  }

  async connect(accessToken: string) {
    if (this._socket) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this._socket = io(RADPAIR_URL, {
        extraHeaders: { Authorization: `Bearer ${accessToken}` },
        path: '/api/socket.io',
        // reconnectionDelayMax: 10000,
        // transports: ['websocket'],
      });

      this._socket.on('connect', () => {
        console.log('Socket connected successfully');
        resolve();
      });

      this._socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err);
        reject();
      });

      this._socket.on('disconnect', (reason) => {
        console.log('Socket disconnected', reason);
      });
    });
  }

  async createReport(
    reportDetails: IReportCreate,
  ): Promise<{ report_id: string }> {
    return new Promise((resolve, reject) => {
      if (!this._socket) {
        return;
      }

      this._socket.emit(
        'create_report',
        reportDetails,
        (response: { report_id: string }) => {
          if (response) {
            resolve(response);
          } else {
            reject(new Error('Report creation failed'));
          }
        },
      );
    });
  }

  subscribeToReportUpdate(callback: (data: IReportUpdate) => void) {
    if (!this._socket) {
      return;
    }

    this._socket.on('update_final_report', callback);
  }

  disconnect() {
    if (this._socket) {
      this._socket.disconnect();
      this._socket = null;
    }
  }

  reconnect() {
    if (this._socket) {
      this._socket.connect();
    }
  }
}

const socketService = new SocketService();

export default socketService;
