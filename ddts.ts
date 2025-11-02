// ==================== ENUMS AND CONSTANTS ====================

enum VehicleType {
    MOTORCYCLE = 'MOTORCYCLE',
    CAR = 'CAR',
    BUS = 'BUS'
}

enum SpotSize {
    SMALL = 'SMALL',    // For motorcycles
    MEDIUM = 'MEDIUM',  // For cars
    LARGE = 'LARGE'     // For buses
}

enum SpotStatus {
    AVAILABLE = 'AVAILABLE',
    OCCUPIED = 'OCCUPIED',
    RESERVED = 'RESERVED',
    OUT_OF_SERVICE = 'OUT_OF_SERVICE'
}

enum TransactionStatus {
    ACTIVE = 'ACTIVE',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED'
}

// Pricing configuration (per hour in currency units)
const PRICING_CONFIG = {
    [VehicleType.MOTORCYCLE]: 10,
    [VehicleType.CAR]: 20,
    [VehicleType.BUS]: 40
};

// Vehicle size to spot size mapping
const VEHICLE_SPOT_MAPPING = {
    [VehicleType.MOTORCYCLE]: [SpotSize.SMALL, SpotSize.MEDIUM, SpotSize.LARGE],
    [VehicleType.CAR]: [SpotSize.MEDIUM, SpotSize.LARGE],
    [VehicleType.BUS]: [SpotSize.LARGE]
};

// ==================== DATA MODELS ====================

interface ParkingSpot {
    id: string;
    floorNumber: number;
    spotNumber: number;
    size: SpotSize;
    status: SpotStatus;
    vehicleId?: string;
    reservedUntil?: Date;
}

interface Vehicle {
    id: string;
    licensePlate: string;
    type: VehicleType;
    ownerName?: string;
    ownerContact?: string;
}

interface ParkingTransaction {
    id: string;
    vehicleId: string;
    spotId: string;
    entryTime: Date;
    exitTime?: Date;
    status: TransactionStatus;
    fee?: number;
}

interface ParkingTicket {
    ticketId: string;
    transactionId: string;
    licensePlate: string;
    spotLocation: string;
    entryTime: Date;
    vehicleType: VehicleType;
}

interface PaymentReceipt {
    receiptId: string;
    transactionId: string;
    licensePlate: string;
    entryTime: Date;
    exitTime: Date;
    duration: number; // in hours
    fee: number;
    vehicleType: VehicleType;
}

// ==================== DATABASE SCHEMA (for SQL) ====================

/*
SQL Schema Design:

CREATE TABLE parking_spots (
  id VARCHAR(50) PRIMARY KEY,
  floor_number INT NOT NULL,
  spot_number INT NOT NULL,
  size VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
  vehicle_id VARCHAR(50),
  reserved_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_floor_spot (floor_number, spot_number),
  INDEX idx_status_size (status, size),
  INDEX idx_vehicle (vehicle_id),
  INDEX idx_floor (floor_number)
);

CREATE TABLE vehicles (
  id VARCHAR(50) PRIMARY KEY,
  license_plate VARCHAR(20) UNIQUE NOT NULL,
  type VARCHAR(20) NOT NULL,
  owner_name VARCHAR(100),
  owner_contact VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_license (license_plate)
);

CREATE TABLE parking_transactions (
  id VARCHAR(50) PRIMARY KEY,
  vehicle_id VARCHAR(50) NOT NULL,
  spot_id VARCHAR(50) NOT NULL,
  entry_time TIMESTAMP NOT NULL,
  exit_time TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  fee DECIMAL(10, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (spot_id) REFERENCES parking_spots(id),
  INDEX idx_vehicle_status (vehicle_id, status),
  INDEX idx_spot (spot_id),
  INDEX idx_status (status),
  INDEX idx_entry_time (entry_time)
);
*/

// ==================== REPOSITORY LAYER ====================

class ParkingSpotRepository {
    private spots: Map<string, ParkingSpot> = new Map();
    private locks: Map<string, boolean> = new Map();

    async findAvailableSpots(size: SpotSize): Promise<ParkingSpot[]> {
        return Array.from(this.spots.values()).filter(
            spot => spot.status === SpotStatus.AVAILABLE && spot.size === size
        );
    }

    async findById(spotId: string): Promise<ParkingSpot | null> {
        return this.spots.get(spotId) || null;
    }

    async updateStatus(spotId: string, status: SpotStatus, vehicleId?: string): Promise<void> {
        const spot = this.spots.get(spotId);
        if (spot) {
            spot.status = status;
            spot.vehicleId = vehicleId;
            this.spots.set(spotId, spot);
        }
    }

    async acquireLock(spotId: string, timeout: number = 5000): Promise<boolean> {
        const startTime = Date.now();
        while (this.locks.get(spotId)) {
            if (Date.now() - startTime > timeout) {
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        this.locks.set(spotId, true);
        return true;
    }

    async releaseLock(spotId: string): Promise<void> {
        this.locks.delete(spotId);
    }

    async initializeSpots(floors: number, spotsPerFloor: number): Promise<void> {
        for (let floor = 1; floor <= floors; floor++) {
            for (let spot = 1; spot <= spotsPerFloor; spot++) {
                const id = `F${floor}-S${spot}`;
                let size: SpotSize;

                // Distribution: 40% small, 40% medium, 20% large
                if (spot <= spotsPerFloor * 0.4) {
                    size = SpotSize.SMALL;
                } else if (spot <= spotsPerFloor * 0.8) {
                    size = SpotSize.MEDIUM;
                } else {
                    size = SpotSize.LARGE;
                }

                this.spots.set(id, {
                    id,
                    floorNumber: floor,
                    spotNumber: spot,
                    size,
                    status: SpotStatus.AVAILABLE
                });
            }
        }
    }

    async getAvailabilityByFloor(): Promise<Map<number, number>> {
        const availability = new Map<number, number>();
        for (const spot of this.spots.values()) {
            if (spot.status === SpotStatus.AVAILABLE) {
                availability.set(spot.floorNumber, (availability.get(spot.floorNumber) || 0) + 1);
            }
        }
        return availability;
    }
}

class VehicleRepository {
    private vehicles: Map<string, Vehicle> = new Map();
    private licensePlateIndex: Map<string, string> = new Map();

    async save(vehicle: Vehicle): Promise<Vehicle> {
        this.vehicles.set(vehicle.id, vehicle);
        this.licensePlateIndex.set(vehicle.licensePlate, vehicle.id);
        return vehicle;
    }

    async findById(id: string): Promise<Vehicle | null> {
        return this.vehicles.get(id) || null;
    }

    async findByLicensePlate(licensePlate: string): Promise<Vehicle | null> {
        const id = this.licensePlateIndex.get(licensePlate);
        return id ? this.vehicles.get(id) || null : null;
    }
}

class TransactionRepository {
    private transactions: Map<string, ParkingTransaction> = new Map();

    async save(transaction: ParkingTransaction): Promise<ParkingTransaction> {
        this.transactions.set(transaction.id, transaction);
        return transaction;
    }

    async findById(id: string): Promise<ParkingTransaction | null> {
        return this.transactions.get(id) || null;
    }

    async findActiveByVehicleId(vehicleId: string): Promise<ParkingTransaction | null> {
        return Array.from(this.transactions.values()).find(
            t => t.vehicleId === vehicleId && t.status === TransactionStatus.ACTIVE
        ) || null;
    }

    async update(transaction: ParkingTransaction): Promise<void> {
        this.transactions.set(transaction.id, transaction);
    }
}

// ==================== SPOT ALLOCATION ALGORITHM ====================

class SpotAllocationStrategy {
    /**
     * Nearest spot allocation - finds the closest available spot on the lowest floor
     * This minimizes the distance for customers
     */
    async allocateSpot(
        spotRepo: ParkingSpotRepository,
        vehicleType: VehicleType
    ): Promise<ParkingSpot | null> {
        const allowedSizes = VEHICLE_SPOT_MAPPING[vehicleType];

        // Try each allowed size in order (prefer exact fit first)
        for (const size of allowedSizes) {
            const availableSpots = await spotRepo.findAvailableSpots(size);

            if (availableSpots.length > 0) {
                // Sort by floor (ascending) then by spot number (ascending)
                availableSpots.sort((a, b) => {
                    if (a.floorNumber !== b.floorNumber) {
                        return a.floorNumber - b.floorNumber;
                    }
                    return a.spotNumber - b.spotNumber;
                });

                return availableSpots[0];
            }
        }

        return null;
    }

    /**
     * Load balancing allocation - distributes vehicles evenly across floors
     */
    async allocateSpotBalanced(
        spotRepo: ParkingSpotRepository,
        vehicleType: VehicleType
    ): Promise<ParkingSpot | null> {
        const allowedSizes = VEHICLE_SPOT_MAPPING[vehicleType];
        const availability = await spotRepo.getAvailabilityByFloor();

        for (const size of allowedSizes) {
            const availableSpots = await spotRepo.findAvailableSpots(size);

            if (availableSpots.length > 0) {
                // Find floor with most available spots
                const floorWithMostSpots = Array.from(availability.entries())
                    .sort((a, b) => b[1] - a[1])[0]?.[0];

                // Try to allocate on that floor first
                const preferredSpot = availableSpots.find(
                    spot => spot.floorNumber === floorWithMostSpots
                );

                return preferredSpot || availableSpots[0];
            }
        }

        return null;
    }
}

// ==================== FEE CALCULATION ====================

class FeeCalculator {
    /**
     * Calculate parking fee based on duration and vehicle type
     * Fee is calculated per hour with ceiling rounding (partial hours count as full hour)
     */
    calculateFee(vehicleType: VehicleType, entryTime: Date, exitTime: Date): number {
        const durationMs = exitTime.getTime() - entryTime.getTime();
        const durationHours = Math.ceil(durationMs / (1000 * 60 * 60));

        // Minimum 1 hour charge
        const billableHours = Math.max(1, durationHours);

        const hourlyRate = PRICING_CONFIG[vehicleType];
        return hourlyRate * billableHours;
    }

    /**
     * Get parking duration in hours (with decimal precision)
     */
    getDuration(entryTime: Date, exitTime: Date): number {
        const durationMs = exitTime.getTime() - entryTime.getTime();
        return durationMs / (1000 * 60 * 60);
    }
}

// ==================== CORE SERVICE LAYER ====================

class ParkingLotService {
    private spotRepo: ParkingSpotRepository;
    private vehicleRepo: VehicleRepository;
    private transactionRepo: TransactionRepository;
    private allocationStrategy: SpotAllocationStrategy;
    private feeCalculator: FeeCalculator;

    constructor() {
        this.spotRepo = new ParkingSpotRepository();
        this.vehicleRepo = new VehicleRepository();
        this.transactionRepo = new TransactionRepository();
        this.allocationStrategy = new SpotAllocationStrategy();
        this.feeCalculator = new FeeCalculator();
    }

    async initialize(floors: number, spotsPerFloor: number): Promise<void> {
        await this.spotRepo.initializeSpots(floors, spotsPerFloor);
    }

    /**
     * Vehicle check-in with automatic spot allocation
     * Handles concurrency through spot locking mechanism
     */
    async checkIn(
        licensePlate: string,
        vehicleType: VehicleType,
        ownerName?: string,
        ownerContact?: string
    ): Promise<ParkingTicket> {
        // Check if vehicle already has an active transaction
        let vehicle = await this.vehicleRepo.findByLicensePlate(licensePlate);

        if (vehicle) {
            const activeTransaction = await this.transactionRepo.findActiveByVehicleId(vehicle.id);
            if (activeTransaction) {
                throw new Error('Vehicle is already parked in the lot');
            }
        } else {
            // Register new vehicle
            vehicle = await this.vehicleRepo.save({
                id: this.generateId('VEH'),
                licensePlate,
                type: vehicleType,
                ownerName,
                ownerContact
            });
        }

        // Allocate parking spot with retry mechanism for concurrency
        let spot: ParkingSpot | null = null;
        let retries = 3;

        while (retries > 0 && !spot) {
            const candidateSpot = await this.allocationStrategy.allocateSpot(
                this.spotRepo,
                vehicleType
            );

            if (!candidateSpot) {
                throw new Error('No available parking spots for this vehicle type');
            }

            // Acquire lock to prevent race conditions
            const lockAcquired = await this.spotRepo.acquireLock(candidateSpot.id);

            if (lockAcquired) {
                try {
                    // Double-check spot is still available
                    const currentSpot = await this.spotRepo.findById(candidateSpot.id);
                    if (currentSpot && currentSpot.status === SpotStatus.AVAILABLE) {
                        await this.spotRepo.updateStatus(
                            candidateSpot.id,
                            SpotStatus.OCCUPIED,
                            vehicle.id
                        );
                        spot = candidateSpot;
                    }
                } finally {
                    await this.spotRepo.releaseLock(candidateSpot.id);
                }
            }

            retries--;
        }

        if (!spot) {
            throw new Error('Failed to allocate parking spot. Please try again.');
        }

        // Create transaction
        const transaction = await this.transactionRepo.save({
            id: this.generateId('TXN'),
            vehicleId: vehicle.id,
            spotId: spot.id,
            entryTime: new Date(),
            status: TransactionStatus.ACTIVE
        });

        // Generate ticket
        return {
            ticketId: this.generateId('TKT'),
            transactionId: transaction.id,
            licensePlate: vehicle.licensePlate,
            spotLocation: `Floor ${spot.floorNumber}, Spot ${spot.spotNumber}`,
            entryTime: transaction.entryTime,
            vehicleType: vehicle.type
        };
    }

    /**
     * Vehicle check-out with fee calculation
     */
    async checkOut(licensePlate: string): Promise<PaymentReceipt> {
        const vehicle = await this.vehicleRepo.findByLicensePlate(licensePlate);

        if (!vehicle) {
            throw new Error('Vehicle not found');
        }

        const transaction = await this.transactionRepo.findActiveByVehicleId(vehicle.id);

        if (!transaction) {
            throw new Error('No active parking session found for this vehicle');
        }

        const exitTime = new Date();
        const fee = this.feeCalculator.calculateFee(vehicle.type, transaction.entryTime, exitTime);
        const duration = this.feeCalculator.getDuration(transaction.entryTime, exitTime);

        // Update transaction
        transaction.exitTime = exitTime;
        transaction.status = TransactionStatus.COMPLETED;
        transaction.fee = fee;
        await this.transactionRepo.update(transaction);

        // Release parking spot
        await this.spotRepo.updateStatus(transaction.spotId, SpotStatus.AVAILABLE);

        // Generate receipt
        return {
            receiptId: this.generateId('RCP'),
            transactionId: transaction.id,
            licensePlate: vehicle.licensePlate,
            entryTime: transaction.entryTime,
            exitTime,
            duration,
            fee,
            vehicleType: vehicle.type
        };
    }

    /**
     * Get real-time availability statistics
     */
    async getAvailability(): Promise<{
        total: number;
        occupied: number;
        available: number;
        bySize: Record<SpotSize, number>;
        byFloor: Map<number, number>;
    }> {
        const spots = Array.from((this.spotRepo as any).spots.values()) as ParkingSpot[];
        const bySize: Record<SpotSize, number> = {
            [SpotSize.SMALL]: 0,
            [SpotSize.MEDIUM]: 0,
            [SpotSize.LARGE]: 0
        };

        let available = 0;
        let occupied = 0;

        spots.forEach(spot => {
            if (spot.status === SpotStatus.AVAILABLE) {
                available++;
                bySize[spot.size]++;
            } else if (spot.status === SpotStatus.OCCUPIED) {
                occupied++;
            }
        });

        return {
            total: spots.length,
            occupied,
            available,
            bySize,
            byFloor: await this.spotRepo.getAvailabilityByFloor()
        };
    }

    private generateId(prefix: string): string {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

// ==================== API CONTROLLER LAYER ====================

class ParkingLotController {
    private service: ParkingLotService;

    constructor(service: ParkingLotService) {
        this.service = service;
    }

    /**
     * POST /api/parking/check-in
     */
    async handleCheckIn(req: {
        licensePlate: string;
        vehicleType: VehicleType;
        ownerName?: string;
        ownerContact?: string;
    }): Promise<{ success: boolean; data?: ParkingTicket; error?: string }> {
        try {
            const ticket = await this.service.checkIn(
                req.licensePlate,
                req.vehicleType,
                req.ownerName,
                req.ownerContact
            );
            return { success: true, data: ticket };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * POST /api/parking/check-out
     */
    async handleCheckOut(req: {
        licensePlate: string;
    }): Promise<{ success: boolean; data?: PaymentReceipt; error?: string }> {
        try {
            const receipt = await this.service.checkOut(req.licensePlate);
            return { success: true, data: receipt };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * GET /api/parking/availability
     */
    async handleGetAvailability(): Promise<{
        success: boolean;
        data?: any;
        error?: string;
    }> {
        try {
            const availability = await this.service.getAvailability();
            return {
                success: true,
                data: {
                    ...availability,
                    byFloor: Object.fromEntries(availability.byFloor)
                }
            };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }
}

// ==================== USAGE EXAMPLE ====================

async function demo() {
    const service = new ParkingLotService();
    await service.initialize(3, 10); // 3 floors, 10 spots per floor

    const controller = new ParkingLotController(service);

    // Simulate concurrent check-ins
    console.log('=== Simulating Concurrent Vehicle Check-ins ===\n');

    const checkIns = await Promise.all([
        controller.handleCheckIn({ licensePlate: 'ABC123', vehicleType: VehicleType.CAR }),
        controller.handleCheckIn({ licensePlate: 'XYZ789', vehicleType: VehicleType.MOTORCYCLE }),
        controller.handleCheckIn({ licensePlate: 'BUS001', vehicleType: VehicleType.BUS }),
        controller.handleCheckIn({ licensePlate: 'CAR456', vehicleType: VehicleType.CAR })
    ]);

    checkIns.forEach((result, i) => {
        console.log(`Vehicle ${i + 1}:`, result.success ? result.data : result.error);
    });

    // Check availability
    console.log('\n=== Current Availability ===\n');
    const availability = await controller.handleGetAvailability();
    console.log(availability.data);

    // Simulate check-out
    console.log('\n=== Vehicle Check-out ===\n');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate parking duration
    const checkOut = await controller.handleCheckOut({ licensePlate: 'ABC123' });
    console.log('Check-out result:', checkOut.data);

    // Final availability
    console.log('\n=== Final Availability ===\n');
    const finalAvailability = await controller.handleGetAvailability();
    console.log(finalAvailability.data);
}

// Uncomment to run demo
// demo().catch(console.error);

export {
    ParkingLotService,
    ParkingLotController,
    VehicleType,
    SpotSize,
    SpotStatus,
    TransactionStatus
};