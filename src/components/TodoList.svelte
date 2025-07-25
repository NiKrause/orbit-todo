<script>
  import { formatPeerId } from '../lib/p2p.js';
  
  export let todos;
  export let peers;
  export let onToggleComplete;
  export let onDelete;
  export let onAssign;
</script>

<div class="bg-white rounded-lg shadow-md p-6 mb-6">
  <h2 class="text-xl font-semibold mb-4">TODO Items ({todos.length})</h2>
  {#if todos.length > 0}
    <div class="space-y-3">
      {#each todos as { id, text, completed, assignee, createdBy }}
        <div class="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50">
          <div class="flex items-center space-x-3 flex-1">
            <input 
              type="checkbox" 
              checked={completed} 
              on:change={() => onToggleComplete(id)} 
              class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <div class="flex-1">
              <span class={completed ? 'line-through text-gray-500' : 'text-gray-800'}>
                {text}
              </span>
              <div class="text-sm text-gray-500 mt-1">
                {#if assignee}
                  Assigned to: <code class="bg-gray-100 px-1 rounded">{formatPeerId(assignee)}</code>
                {:else}
                  <span class="text-orange-600">Unassigned</span>
                {/if}
                • Created by: <code class="bg-gray-100 px-1 rounded">{formatPeerId(createdBy)}</code>
              </div>
            </div>
          </div>
          <div class="flex space-x-2">
            {#if peers.length > 0}
              <select 
                on:change={(e) => onAssign(id, e.target.value)}
                class="text-sm border border-gray-300 rounded px-2 py-1"
              >
                <option value="">Assign to...</option>
                {#each peers as { peerId }}
                  <option value={peerId}>{formatPeerId(peerId)}...</option>
                {/each}
              </select>
            {/if}
            <button 
              on:click={() => onDelete(id)} 
              class="text-red-500 hover:text-red-700 px-3 py-1 rounded-md transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <p class="text-gray-500 text-center py-8">No TODOs yet. Add one above!</p>
  {/if}
</div>
