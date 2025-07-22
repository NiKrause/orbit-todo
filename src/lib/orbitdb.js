import { createHelia } from 'helia'
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core'
import { LevelDatastore } from 'datastore-level'
import { LevelBlockstore } from 'blockstore-level'
import { OrbitDBTopicDiscovery } from './orbit-discovery.js'

let helia = null
let orbitdb = null
let todoDB = null

export async function createHeliaAndOrbitDB(libp2p) {
  let blockstore = new LevelBlockstore('./helia-blocks')
  let datastore = new LevelDatastore('./helia-data')
  helia = await createHelia({ libp2p, blockstore, datastore })
  orbitdb = await createOrbitDB({
    ipfs: helia,
    id: 'todo-p2p-app',
    directory: './orbitdb-data',
    AccessControllers: { 'ipfs': IPFSAccessController }
  })
  return { helia, orbitdb }
}

export async function setupOrbitDBTopicDiscovery(helia, onDiscovered) {
  const discovery = new OrbitDBTopicDiscovery(helia)
  await discovery.startDiscovery(async (topic, peerId) => {
    await helia.libp2p.services.pubsub.subscribe(topic)
    onDiscovered?.(topic, peerId)
  })
  await discovery.enableAutoSubscribe(() => {})
  return discovery
}

export async function getTodoDatabase() {
  if (!orbitdb) throw new Error('OrbitDB not initialized')
  if (!todoDB) {
    try {
      todoDB = await orbitdb.open('todos', {
        type: 'keyvalue',
        AccessController: IPFSAccessController({ write: ['*'] })
      })
    } catch (error) {
      try {
        todoDB = await orbitdb.open('todos', {
          type: 'keyvalue',
          accessController: { type: 'ipfs', write: ['*'] }
        })
      } catch (error2) {
        todoDB = await orbitdb.open('todos', { type: 'keyvalue' })
      }
    }
  }
  return todoDB
}

export async function addTodo(text, assignee = null, libp2p) {
  const db = await getTodoDatabase()
  if (!text || typeof text !== 'string') throw new Error('Todo text must be a non-empty string')
  if (assignee !== null && typeof assignee !== 'string') throw new Error('Assignee must be a string or null')
  const todoId = Date.now().toString()
  const todo = {
    text: String(text).trim(),
    assignee: assignee ? String(assignee).trim() : null,
    completed: false,
    createdAt: new Date().toISOString(),
    createdBy: libp2p?.peerId?.toString() || 'unknown'
  }
  await db.set(todoId, todo)
  return { id: todoId, ...todo }
}

export async function updateTodo(id, updates, libp2p) {
  const db = await getTodoDatabase()
  const existingTodo = await db.get(id)
  if (existingTodo) {
    const updatedTodo = {
      ...existingTodo,
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy: libp2p.peerId.toString()
    }
    await db.set(id, updatedTodo)
    return { id, ...updatedTodo }
  }
  throw new Error(`Todo with id ${id} not found`)
}

export async function deleteTodo(id) {
  const db = await getTodoDatabase()
  const existingTodo = await db.get(id)
  if (existingTodo) {
    if (typeof db.delete === 'function') {
      await db.delete(id)
    } else if (typeof db.del === 'function') {
      await db.del(id)
    } else if (typeof db.remove === 'function') {
      await db.remove(id)
    } else if (typeof db.set === 'function') {
      await db.set(id, null)
    } else {
      throw new Error('No delete method found on database object')
    }
    return true
  }
  return false
}

export async function getAllTodos() {
  const db = await getTodoDatabase()
  const allDocs = await db.all()
  let todos = []
  if (Array.isArray(allDocs)) {
    todos = allDocs.map(doc => {
      if (!doc || !doc.value || typeof doc.value !== 'object') return null
      const value = doc.value
      const key = doc.key
      return {
        id: key,
        text: value.text || '',
        assignee: value.assignee || null,
        completed: Boolean(value.completed),
        createdAt: value.createdAt || new Date().toISOString(),
        createdBy: value.createdBy || 'unknown',
        updatedAt: value.updatedAt || null,
        updatedBy: value.updatedBy || null
      }
    }).filter(Boolean)
  } else if (allDocs && typeof allDocs === 'object') {
    todos = Object.entries(allDocs).map(([key, value]) => {
      if (!value || typeof value !== 'object') return null
      return {
        id: key,
        text: value.text || '',
        assignee: value.assignee || null,
        completed: Boolean(value.completed),
        createdAt: value.createdAt || new Date().toISOString(),
        createdBy: value.createdBy || 'unknown',
        updatedAt: value.updatedAt || null,
        updatedBy: value.updatedBy || null
      }
    }).filter(Boolean)
  }
  return todos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}