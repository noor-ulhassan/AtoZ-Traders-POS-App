import type { Category, Id } from '@shared/types'
import type { Db } from '../db/connection'

interface CategoryRow {
  id: number
  name: string
  product_count: number
}

const toCategory = (row: CategoryRow): Category => ({
  id: row.id,
  name: row.name,
  productCount: row.product_count
})

const SELECT = `
  SELECT c.id,
         c.name,
         (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
    FROM categories c
`

export function listCategories(db: Db): Category[] {
  return db
    .prepare<[], CategoryRow>(`${SELECT} ORDER BY c.name COLLATE NOCASE`)
    .all()
    .map(toCategory)
}

export function findCategory(db: Db, id: Id): Category | null {
  const row = db.prepare<[Id], CategoryRow>(`${SELECT} WHERE c.id = ?`).get(id)
  return row ? toCategory(row) : null
}

/**
 * Look a category up by name, the way a person reads it rather than the way
 * the UNIQUE index compares it — "grocery" and "Grocery" are the same category
 * to a shopkeeper. Used by the sample-data seeder to reuse what a shop already
 * has instead of trying to insert a second one.
 */
export function findCategoryByName(db: Db, name: string): Category | null {
  const row = db
    .prepare<[string], CategoryRow>(`${SELECT} WHERE c.name = ? COLLATE NOCASE`)
    .get(name.trim())
  return row ? toCategory(row) : null
}

export function insertCategory(db: Db, name: string): Id {
  const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name)
  return Number(info.lastInsertRowid)
}

export function updateCategoryName(db: Db, id: Id, name: string): void {
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id)
}

export function deleteCategory(db: Db, id: Id): void {
  db.prepare('DELETE FROM categories WHERE id = ?').run(id)
}

export function countProductsInCategory(db: Db, id: Id): number {
  const row = db
    .prepare<[Id], { total: number }>(
      'SELECT COUNT(*) AS total FROM products WHERE category_id = ?'
    )
    .get(id)
  return row?.total ?? 0
}
