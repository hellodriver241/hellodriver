export type TripStatus =
  | 'pending_bids'
  | 'bid_accepted'
  | 'driver_en_route'
  | 'driver_arrived'
  | 'in_transit'
  | 'completed'
  | 'rated'
  | 'cancelled_by_client'
  | 'cancelled_by_driver'
  | 'no_bids'
  | 'driver_no_show'
  | 'expired'
  | 'payment_failed';

export const VALID_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  pending_bids: ['bid_accepted', 'no_bids', 'cancelled_by_client', 'expired'],
  bid_accepted: ['driver_en_route', 'cancelled_by_client', 'cancelled_by_driver'],
  driver_en_route: ['driver_arrived', 'cancelled_by_client', 'cancelled_by_driver'],
  driver_arrived: ['in_transit', 'driver_no_show', 'cancelled_by_client'],
  in_transit: ['completed'],
  completed: ['rated', 'payment_failed'],
  rated: [],
  cancelled_by_client: [],
  cancelled_by_driver: [],
  no_bids: ['pending_bids', 'cancelled_by_client'],      // client can rebook or cancel
  driver_no_show: ['cancelled_by_client', 'pending_bids'], // client can cancel or rebook
  expired: [],
  payment_failed: [],
};

export interface Trip {
  id: string;
  clientId: string;
  driverId: string | null;
  status: TripStatus;
  originAddress: string | null;
  originLatitude: string;
  originLongitude: string;
  destinationAddress: string | null;
  destinationLatitude: string;
  destinationLongitude: string;
  fareEstimateXaf: number | null;
  finalFareXaf: number | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  completedAt: Date | null;
}

export interface TripBid {
  id: string;
  tripId: string;
  driverId: string;
  amountXaf: number;
  etaMinutes: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: Date;
  expiresAt: Date | null;
}
