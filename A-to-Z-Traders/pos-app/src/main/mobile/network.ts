import { networkInterfaces } from 'node:os'

/**
 * Which addresses count as "the shop", and what to tell the owner to type.
 *
 * The companion app is a local-network feature and stays one. Everything here
 * exists to keep it that way: the server only answers a caller on a private
 * address, and only advertises addresses a phone on the same Wi-Fi can
 * actually reach. A POS is not a thing to put on the public internet, and the
 * simplest way to be sure it never drifts there is to refuse anything that is
 * not obviously next door.
 */

/**
 * Node hands back an IPv4-mapped IPv6 address (`::ffff:192.168.1.9`) when a
 * socket arrives on a dual-stack listener. Strip the prefix so one set of
 * range checks below covers both.
 */
export function normalizeAddress(address: string | undefined | null): string {
  if (!address) return ''
  const trimmed = address.trim()
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed
}

/**
 * True for a loopback or RFC 1918 address — the machine itself, or a device on
 * the same home/shop network. Everything else is refused before it is read.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = normalizeAddress(address)
  if (ip === '::1') return true

  const parts = ip.split('.')
  if (parts.length !== 4) return false

  const octets = parts.map((part) => Number(part))
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false

  const [a, b] = octets as [number, number, number, number]
  if (a === 127) return true // loopback
  if (a === 10) return true // 10.0.0.0/8
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  return false
}

/**
 * Every private IPv4 address this machine currently holds, loopback last.
 *
 * A shop PC often has more than one — Wi-Fi and Ethernet, or a virtual adapter
 * left behind by some other program — and only the person standing there knows
 * which one the phone is on. So all of them are shown rather than one guessed
 * at, in the order most likely to be the right one first.
 */
export function lanAddresses(): string[] {
  const found: string[] = []

  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4') continue
      if (entry.internal) continue
      if (!isPrivateAddress(entry.address)) continue
      found.push(entry.address)
    }
  }

  // A shop router hands out 192.168.x.x far more often than anything else, so
  // put those first; the owner should find the address that works at the top.
  found.sort((left, right) => {
    const rank = (ip: string): number =>
      ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2
    return rank(left) - rank(right) || left.localeCompare(right)
  })

  return found
}

/** The addresses to show the owner, as URLs ready to type into a phone. */
export function mobileUrls(port: number): string[] {
  return lanAddresses().map((address) => `http://${address}:${port}`)
}
