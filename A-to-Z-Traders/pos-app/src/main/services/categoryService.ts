import type { Category, Id } from '@shared/types'
import { getDb } from '../db/connection'
import * as repository from '../repositories/categoryRepository'
import { conflict, notFound } from '../utils/errors'

export function listCategories(): Category[] {
  return repository.listCategories(getDb())
}

export function addCategory(name: string): Category {
  const db = getDb()
  const id = repository.insertCategory(db, name)
  return repository.findCategory(db, id) as Category
}

export function updateCategory(id: Id, name: string): Category {
  const db = getDb()
  if (!repository.findCategory(db, id)) throw notFound('Category')
  repository.updateCategoryName(db, id, name)
  return repository.findCategory(db, id) as Category
}

/**
 * Categories are deletable only while unused. Detaching them from products
 * instead would quietly change how past sales are grouped in reports.
 */
export function removeCategory(id: Id): { id: Id } {
  const db = getDb()
  if (!repository.findCategory(db, id)) throw notFound('Category')

  const inUse = repository.countProductsInCategory(db, id)
  if (inUse > 0) {
    throw conflict(
      `This category is used by ${inUse} product${inUse === 1 ? '' : 's'}. Move them to another category first.`
    )
  }

  repository.deleteCategory(db, id)
  return { id }
}
