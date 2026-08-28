import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/main/db/connection'
import { createTestDb } from './helpers/database'
import { parseCsv } from '../src/main/utils/csv'
import * as categoryService from '../src/main/services/categoryService'
import * as importService from '../src/main/services/productImportService'
import * as inventoryService from '../src/main/services/inventoryService'
import * as productService from '../src/main/services/productService'
import { sumMovements } from '../src/main/repositories/stockRepository'

let db: Db

beforeEach(() => {
  db = createTestDb()
  importService.clearPendingImport()
})

/** Runs the real two-step, skipping only the native file picker. */
function importCsv(
  text: string,
  fileName = 'products.csv'
): ReturnType<typeof importService.commitImport> {
  const preview = importService.buildPreview(db, text, fileName)
  importService.stagePreview(preview)
  return importService.commitImport(preview.token)
}

describe('parseCsv', () => {
  it('reads a plain file', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('strips the BOM Excel writes', () => {
    expect(parseCsv('﻿name\nSoap')).toEqual([['name'], ['Soap']])
  })

  it('keeps commas and newlines inside quoted fields', () => {
    expect(parseCsv('name,note\n"Rice, basmati","line one\nline two"')).toEqual([
      ['name', 'note'],
      ['Rice, basmati', 'line one\nline two']
    ])
  })

  it('reads a doubled quote as one literal quote', () => {
    expect(parseCsv('name\n"6"" pipe"')).toEqual([['name'], ['6" pipe']])
  })

  it('handles CRLF and a trailing newline without inventing a row', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('drops blank lines', () => {
    expect(parseCsv('a\n\nb\n')).toEqual([['a'], ['b']])
  })
})

describe('previewing a file', () => {
  it('refuses a file with no name column', () => {
    expect(() => importService.buildPreview(db, 'sku,price\nA1,50', 'x.csv')).toThrow(
      /needs a "Name" column/
    )
  })

  it('accepts columns in any order, under any of their aliases', () => {
    const preview = importService.buildPreview(
      db,
      'Rate,Item Name,Qty,Buying Price\n250,Cooking Oil 5L,40,210',
      'x.csv'
    )

    const row = preview.rows[0]!
    expect(row.name).toBe('Cooking Oil 5L')
    expect(row.salePrice).toBe(250)
    expect(row.costPrice).toBe(210)
    expect(row.openingStock).toBe(40)
    expect(row.action).toBe('create')
  })

  it('reads prices a spreadsheet has already formatted', () => {
    const preview = importService.buildPreview(
      db,
      'name,price,cost\nSugar,"1,250.50",Rs 900\n',
      'x.csv'
    )

    const row = preview.rows[0]!
    expect(row.salePrice).toBe(1250.5)
    expect(row.costPrice).toBe(900)
    expect(row.issues).toHaveLength(0)
  })

  it('skips a row rather than guessing at a bad number', () => {
    const preview = importService.buildPreview(db, 'name,price\nSoap,abc', 'x.csv')

    const row = preview.rows[0]!
    expect(row.action).toBe('skip')
    expect(row.issues[0]?.column).toBe('Price')
  })

  it('skips a nameless row', () => {
    const preview = importService.buildPreview(db, 'name,price\n,50', 'x.csv')
    expect(preview.rows[0]?.action).toBe('skip')
  })

  it('catches a SKU repeated within the same file', () => {
    const preview = importService.buildPreview(
      db,
      'name,sku\nSoap Large,A1\nSoap Small,A1',
      'x.csv'
    )

    expect(preview.rows[0]?.action).toBe('create')
    expect(preview.rows[1]?.action).toBe('skip')
    expect(preview.rows[1]?.issues[0]?.message).toMatch(/line 2/)
  })

  it('names the categories it would create, and only for rows that will be written', () => {
    categoryService.addCategory('Grocery')
    const preview = importService.buildPreview(
      db,
      'name,category,price\nRice,Grocery,100\nOil,Cooking,200\nBad,Hardware,xyz',
      'x.csv'
    )

    // 'Grocery' exists, and 'Hardware' is only on a row that will be skipped.
    expect(preview.newCategories).toEqual(['Cooking'])
  })

  it('reports columns it does not understand instead of failing on them', () => {
    const preview = importService.buildPreview(db, 'name,shelf,price\nSoap,A4,50', 'x.csv')
    expect(preview.unknownColumns).toEqual(['shelf'])
    expect(preview.rows[0]?.action).toBe('create')
  })

  it('writes nothing', () => {
    importService.buildPreview(db, 'name,price\nSoap,50', 'x.csv')
    expect(productService.listProducts().total).toBe(0)
  })
})

describe('committing a file', () => {
  it('creates products with opening stock as a real movement', () => {
    const result = importCsv('name,price,cost,stock\nSoap,50,30,20\nRice,120,90,5')

    expect(result.created).toBe(2)
    expect(result.updated).toBe(0)

    const products = productService.listProducts()
    expect(products.total).toBe(2)

    const soap = products.rows.find((row) => row.name === 'Soap')!
    expect(soap.stockQty).toBe(20)
    expect(soap.salePrice).toBe(50)
    expect(soap.costPrice).toBe(30)
    // The ledger, not just the cache, must explain the stock.
    expect(sumMovements(db, soap.id)).toBe(20)

    const movements = inventoryService.listMovements({ productId: soap.id })
    expect(movements.rows[0]?.reason).toBe('opening')
  })

  it('creates the categories the file names', () => {
    const result = importCsv('name,category,price\nRice,Grocery,100\nOil,Grocery,200')

    expect(result.categoriesCreated).toBe(1)
    expect(categoryService.listCategories().map((row) => row.name)).toEqual(['Grocery'])
  })

  it('updates the product an existing SKU points at instead of adding a second', () => {
    importCsv('name,sku,price,cost,stock\nSoap,A1,50,30,20')
    const result = importCsv('name,sku,price\nSoap Deluxe,A1,65')

    expect(result.created).toBe(0)
    expect(result.updated).toBe(1)

    const products = productService.listProducts()
    expect(products.total).toBe(1)
    expect(products.rows[0]?.name).toBe('Soap Deluxe')
    expect(products.rows[0]?.salePrice).toBe(65)
  })

  it('matches on barcode when there is no SKU', () => {
    importCsv('name,barcode,price\nSoap,8901234,50')
    const result = importCsv('name,barcode,price\nSoap Refill,8901234,55')

    expect(result.updated).toBe(1)
    expect(productService.listProducts().total).toBe(1)
  })

  it('leaves the stock of an existing product alone', () => {
    importCsv('name,sku,price,stock\nSoap,A1,50,20')
    const before = productService.listProducts().rows[0]!

    importCsv('name,sku,price,stock\nSoap,A1,55,999')

    const after = productService.listProducts().rows[0]!
    expect(after.salePrice).toBe(55)
    // Stock changes belong to an adjustment, which records why. A spreadsheet
    // must not be able to move it silently.
    expect(after.stockQty).toBe(before.stockQty)
    expect(sumMovements(db, after.id)).toBe(20)
  })

  it('will not restate the cost of a product that already holds stock', () => {
    importCsv('name,sku,price,cost,stock\nSoap,A1,50,30,20')
    importCsv('name,sku,price,cost\nSoap,A1,50,999')

    // Cost is the purchase flow's weighted average once stock exists; letting a
    // file overwrite it would silently restate the profit on past bills.
    expect(productService.listProducts().rows[0]?.costPrice).toBe(30)
  })

  it('writes the good rows and skips the bad ones', () => {
    const result = importCsv('name,price\nSoap,50\n,20\nRice,abc\nOil,300')

    expect(result.created).toBe(2)
    expect(result.skipped).toBe(2)
    expect(productService.listProducts().total).toBe(2)
  })

  it('refuses a file in which nothing is usable', () => {
    expect(() => importCsv('name,price\n,10\n,20')).toThrow(/nothing to import/i)
    expect(productService.listProducts().total).toBe(0)
  })

  it('refuses a token that was never staged', () => {
    expect(() => importService.commitImport('11111111-1111-1111-1111-111111111111')).toThrow(
      /no longer open/
    )
  })

  it('will not commit the same file twice', () => {
    const preview = importService.buildPreview(db, 'name,price\nSoap,50', 'x.csv')
    importService.stagePreview(preview)
    importService.commitImport(preview.token)

    expect(() => importService.commitImport(preview.token)).toThrow(/no longer open/)
    expect(productService.listProducts().total).toBe(1)
  })

  it('rolls the whole file back if any row fails to write', () => {
    // Two rows sharing a barcode pass row-level checks only if the duplicate
    // detection is bypassed — so stage a preview by hand that the unique index
    // will reject, and assert nothing at all lands.
    const preview = importService.buildPreview(
      db,
      'name,barcode,price\nA,111,10\nB,222,20',
      'x.csv'
    )
    preview.rows[1]!.barcode = '111'
    importService.stagePreview(preview)

    expect(() => importService.commitImport(preview.token)).toThrow()
    expect(productService.listProducts().total).toBe(0)
  })
})

describe('barcode uniqueness', () => {
  it('refuses a second product with the same barcode', () => {
    productService.addProduct({
      name: 'Soap',
      barcode: '8901234',
      baseUnit: 'piece',
      costPrice: 10,
      salePrice: 20,
      reorderLevel: 0
    })

    expect(() =>
      productService.addProduct({
        name: 'Shampoo',
        barcode: '8901234',
        baseUnit: 'piece',
        costPrice: 10,
        salePrice: 20,
        reorderLevel: 0
      })
    ).toThrow()
  })

  it('still allows any number of products with no barcode', () => {
    for (const name of ['One', 'Two', 'Three']) {
      productService.addProduct({
        name,
        baseUnit: 'piece',
        costPrice: 10,
        salePrice: 20,
        reorderLevel: 0
      })
    }

    expect(productService.listProducts().total).toBe(3)
  })
})
