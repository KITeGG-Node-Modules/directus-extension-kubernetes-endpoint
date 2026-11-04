import { describe, expect, it } from 'vitest'

import {
  collectNetworkSeries,
  networkCurrentQueries,
  networkRateQueries,
} from '../src/lib/network-metrics.js'

describe('network query builders', () => {
  it('builds rate+total instant queries with an escaped pod selector', () => {
    const queries = networkCurrentQueries('^sd-5-\\d+$', 300)
    expect(queries.receiveRate).toBe(
      'sum by (pod) (rate(container_network_receive_bytes_total{pod=~"^sd-5-\\\\d+$"}[300s]))'
    )
    expect(queries.transmitRate).toContain(
      'container_network_transmit_bytes_total'
    )
    expect(queries.receiveTotal).toBe(
      'sum by (pod) (container_network_receive_bytes_total{pod=~"^sd-5-\\\\d+$"})'
    )
    expect(queries.transmitTotal).toContain(
      'container_network_transmit_bytes_total'
    )
  })

  it('builds rate range queries with the given window', () => {
    const queries = networkRateQueries('^sd-5-\\d+$', 240)
    expect(queries.receiveRate).toBe(
      'sum by (pod) (rate(container_network_receive_bytes_total{pod=~"^sd-5-\\\\d+$"}[240s]))'
    )
    expect(queries.transmitRate).toContain('[240s]')
  })
})

describe('collectNetworkSeries', () => {
  it('combines receive and transmit series per pod from matrix form', () => {
    const series = collectNetworkSeries(
      [
        {
          metric: { pod: 'sd-5-0' },
          values: [
            [100, '12800'],
            [200, '13000'],
          ],
        },
      ],
      [
        {
          metric: { pod: 'sd-5-0' },
          values: [[100, '3584']],
        },
      ]
    )
    expect(series).toEqual([
      {
        pod: 'sd-5-0',
        receive: [
          [100, 12800],
          [200, 13000],
        ],
        transmit: [[100, 3584]],
      },
    ])
  })

  it('accepts instant-query (vector) form and tolerates missing pod labels', () => {
    const series = collectNetworkSeries([{ metric: {}, value: [100, '1'] }], [])
    expect(series).toEqual([{ pod: null, receive: [[100, 1]], transmit: [] }])
  })

  it('sorts pods by name', () => {
    const series = collectNetworkSeries(
      [
        { metric: { pod: 'sd-5-1' }, value: [100, '1'] },
        { metric: { pod: 'sd-5-0' }, value: [100, '2'] },
      ],
      []
    )
    expect(series.map((s) => s.pod)).toEqual(['sd-5-0', 'sd-5-1'])
  })
})
