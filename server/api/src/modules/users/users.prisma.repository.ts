const { normalizeUsername } = require('./users.repository');

const PRISMA_ROLE_BY_APP_ROLE: Record<string, string> = {
  admin: 'ADMIN',
  boss: 'BOSS',
  front_desk: 'FRONT_DESK',
  sales: 'SALES',
  finance: 'FINANCE',
  warehouse: 'WAREHOUSE',
  after_sales: 'AFTER_SALES',
  taster: 'TASTER',
};

const APP_ROLE_BY_PRISMA_ROLE = Object.fromEntries(
  Object.entries(PRISMA_ROLE_BY_APP_ROLE).map(([appRole, prismaRole]) => [prismaRole, appRole]),
);

export function createPrismaUserRepository(prisma: any) {
  return {
    async listUsers() {
      const users = await prisma.user.findMany({
        orderBy: {
          createdAt: 'asc',
        },
      });
      return users.map(toAppUser);
    },

    async findById(id: string) {
      const user = await prisma.user.findUnique({
        where: {
          id,
        },
      });
      return user ? toAppUser(user) : null;
    },

    async findByUsername(username: string) {
      const user = await prisma.user.findUnique({
        where: {
          username: normalizeUsername(username),
        },
      });
      return user ? toAppUser(user) : null;
    },

    async saveUser(user: any) {
      const saved = await prisma.user.upsert({
        where: {
          id: user.id,
        },
        update: toPrismaUserUpdate(user),
        create: toPrismaUserCreate(user),
      });
      return toAppUser(saved);
    },
  };
}

export function toAppUser(user: any) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    passwordHash: user.passwordHash,
    role: APP_ROLE_BY_PRISMA_ROLE[user.role] || String(user.role).toLowerCase(),
    phone: user.phone,
    leaderId: user.leaderId,
    isActive: user.isActive,
    createdAt: toIsoString(user.createdAt),
    updatedAt: toIsoString(user.updatedAt),
  };
}

function toPrismaUserCreate(user: any) {
  return {
    id: user.id,
    name: user.name,
    username: normalizeUsername(user.username),
    passwordHash: user.passwordHash,
    role: toPrismaRole(user.role),
    phone: user.phone || null,
    leaderId: user.leaderId || null,
    isActive: user.isActive,
    createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
    updatedAt: user.updatedAt ? new Date(user.updatedAt) : new Date(),
  };
}

function toPrismaUserUpdate(user: any) {
  return {
    name: user.name,
    username: normalizeUsername(user.username),
    passwordHash: user.passwordHash,
    role: toPrismaRole(user.role),
    phone: user.phone || null,
    leaderId: user.leaderId || null,
    isActive: user.isActive,
    updatedAt: user.updatedAt ? new Date(user.updatedAt) : new Date(),
  };
}

function toPrismaRole(role: string) {
  const prismaRole = PRISMA_ROLE_BY_APP_ROLE[role];
  if (!prismaRole) {
    throw new Error(`Unsupported user role: ${role}`);
  }
  return prismaRole;
}

function toIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ? String(value) : null;
}
