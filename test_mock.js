const uavs = Array.from({length: 15}, (_, i) => ({
    id: i,
    node_type: 0,
    pdr: 0
}));

let totalPdr = 0;
for (const uav of uavs) {
    totalPdr += uav.pdr ?? 0.9;
}
console.log(totalPdr / 15 * 100);
