<script>
  import { formatPeerId } from '../lib/p2p.js';
  
  export let inputText;
  export let assigneeText;
  export let peers;
  export let onAddTodo;
</script>

<div class="bg-white rounded-lg shadow-md p-6 mb-6">
  <h2 class="text-xl font-semibold mb-4">Add New TODO</h2>
  <div class="space-y-4">
    <input
      type="text"
      bind:value={inputText}
      placeholder="What needs to be done?"
      class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      on:keydown={(e) => e.key === 'Enter' && onAddTodo()}
    />
    <div class="flex gap-2">
      <select
        bind:value={assigneeText}
        class="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      >
        <option value="">Assign to...</option>
        {#each peers as { peerId }}
          <option value={peerId}>{formatPeerId(peerId)}...</option>
        {/each}
      </select>
      <button 
        on:click={onAddTodo}
        class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-md font-medium transition-colors"
      >
        Add TODO
      </button>
    </div>
  </div>
</div>
