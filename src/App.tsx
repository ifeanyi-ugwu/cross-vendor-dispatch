import {
  Alert,
  Card,
  Col,
  Layout,
  Row,
  Segmented,
  Select,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import { useMemo, useState } from 'react'
import type { Basket, StrategyName, Temperature, Vendor } from './domain/types.ts'
import { isPlan } from './domain/types.ts'
import { COURIERS, CUSTOMER_AREAS, MEETING_POINTS, VENDORS } from './fixtures/doha.ts'
import { equalShares, shapleyShares, valueProportionalShares } from './planner/allocate.ts'
import { DEFAULT_CONFIG } from './planner/courierRun.ts'
import { leaders, objectiveFor, operatingCost, rank } from './planner/evaluate.ts'
import { planAll } from './planner/strategies.ts'
import { straightLineEta } from './routing/eta.ts'
import { routedEta } from './routing/matrix.ts'
import { PlanMap } from './ui/PlanMap.tsx'

const PLACED_AT = 0

const STRATEGY_BLURB: Record<StrategyName, string> = {
  separate: 'One courier per vendor. What a basket costs today.',
  sequential: 'One courier tours every vendor, then delivers once.',
  rendezvous: 'Couriers collect in parallel, meet, and one carries the rest.',
}

const riyal = (value: number) => `${value.toFixed(2)} QAR`
const minutes = (ms: number) => `${(ms / 60_000).toFixed(0)} min`

export default function App() {
  const [vendorIds, setVendorIds] = useState<string[]>(['v-lusail', 'v-pearl'])
  const [customerId, setCustomerId] = useState(CUSTOMER_AREAS[0].id)
  const [temperature, setTemperature] = useState<Temperature>('hot')
  const [allSchedulable, setAllSchedulable] = useState(false)
  const [chosen, setChosen] = useState<StrategyName | null>(null)
  const [useRealRoads, setUseRealRoads] = useState(true)

  const config = useMemo(
    () => ({ ...DEFAULT_CONFIG, eta: useRealRoads ? routedEta : straightLineEta }),
    [useRealRoads],
  )

  const basket = useMemo<Basket>(() => {
    const customer = CUSTOMER_AREAS.find((area) => area.id === customerId) ?? CUSTOMER_AREAS[0]
    const chosenVendors = vendorIds
      .map((id) => VENDORS.find((vendor) => vendor.id === id))
      .filter((vendor): vendor is Vendor => Boolean(vendor))
      .map((vendor) => (allSchedulable ? { ...vendor, schedulable: true } : vendor))

    return {
      id: 'basket',
      placedAt: PLACED_AT,
      customer,
      orders: chosenVendors.map((vendor) => ({
        vendorId: vendor.id,
        vendor,
        value: 60 + vendor.prepMinutes * 4,
        temperature,
        readyAt: PLACED_AT + vendor.prepMinutes * 60_000,
      })),
    }
  }, [vendorIds, customerId, temperature, allSchedulable])

  const { scored, rejected } = useMemo(() => {
    if (basket.orders.length === 0) return { scored: [], rejected: [] }
    const attempts = planAll({
      basket,
      couriers: COURIERS,
      meetingPoints: MEETING_POINTS,
      config,
      objective: objectiveFor(basket),
    })
    return { scored: rank(attempts, basket), rejected: attempts.filter((a) => !isPlan(a)) }
  }, [basket, config])

  const shown = scored.find((entry) => entry.plan.strategy === chosen) ?? scored[0] ?? null

  // Plans within the model's own accuracy of each other. Calling one of them
  // best would be inventing a preference the numbers do not support.
  const tied = new Set(leaders(scored).map((entry) => entry.plan.strategy))

  const fixedScheduleCount = vendorIds.filter(
    (id) => VENDORS.find((vendor) => vendor.id === id)?.schedulable === false,
  ).length

  const shares = useMemo(() => {
    if (!shown || basket.orders.length < 2) return null
    const ids = basket.orders.map((order) => order.vendorId)

    // What Shapley divides: the cost of the best plan for each subset of
    // vendors, which means re-planning once per coalition.
    const costOf = (coalition: string[]) => {
      if (coalition.length === 0) return 0
      const subset: Basket = {
        ...basket,
        orders: basket.orders.filter((order) => coalition.includes(order.vendorId)),
      }
      const best = rank(
        planAll({
          basket: subset,
          couriers: COURIERS,
          meetingPoints: MEETING_POINTS,
          config,
          objective: objectiveFor(subset),
        }),
        subset,
      )[0]
      return best ? best.operating : 0
    }

    const joint = operatingCost(shown.plan)
    const values = Object.fromEntries(basket.orders.map((order) => [order.vendorId, order.value]))

    return {
      fair: shapleyShares(ids, costOf),
      equal: equalShares(ids, joint),
      byValue: valueProportionalShares(values, joint),
      alone: Object.fromEntries(ids.map((id) => [id, costOf([id])])),
    }
  }, [basket, shown, config])

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header className="masthead">
        <Typography.Title level={4} style={{ margin: 0, color: 'inherit' }}>
          Cross-vendor dispatch
        </Typography.Title>
        <Typography.Text className="masthead-sub">
          One basket, several vendors, one delivery
        </Typography.Text>
      </Layout.Header>

      <Layout.Content className="content">
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={9}>
            <Card title="Basket" size="small">
              <label className="field">
                <span>Vendors</span>
                <Select
                  mode="multiple"
                  value={vendorIds}
                  onChange={setVendorIds}
                  style={{ width: '100%' }}
                  maxCount={4}
                  showSearch={{ optionFilterProp: 'label' }}
                  options={VENDORS.map((vendor) => ({
                    value: vendor.id,
                    label: `${vendor.label} · ${vendor.prepMinutes} min prep${
                      vendor.schedulable ? '' : ' · fixed schedule'
                    }`,
                  }))}
                />
              </label>

              <label className="field">
                <span>Deliver to</span>
                <Select
                  value={customerId}
                  onChange={setCustomerId}
                  style={{ width: '100%' }}
                  options={CUSTOMER_AREAS.map((area) => ({ value: area.id, label: area.label }))}
                />
              </label>

              <label className="field">
                <span>Goods</span>
                <Segmented
                  value={temperature}
                  onChange={(value) => setTemperature(value as Temperature)}
                  options={[
                    { value: 'ambient', label: 'Ambient' },
                    { value: 'chilled', label: 'Chilled' },
                    { value: 'hot', label: 'Hot' },
                  ]}
                  block
                />
              </label>

              <div className="field field-inline" style={{ marginBottom: 12 }}>
                <Switch checked={useRealRoads} onChange={setUseRealRoads} size="small" />
                <span>
                  Use measured road times
                  <Typography.Text type="secondary" className="hint">
                    Driving times from the real Doha network, precomputed offline. Turn
                    this off to fall back to straight-line distance with a fixed detour
                    factor, which flatters long highway runs and undercharges short
                    urban hops.
                  </Typography.Text>
                </span>
              </div>

              <div className="field field-inline">
                <Switch checked={allSchedulable} onChange={setAllSchedulable} size="small" />
                <span>
                  Assume every vendor can be told when to start
                  <Typography.Text type="secondary" className="hint">
                    {fixedScheduleCount === 0
                      ? 'Every vendor in this basket already cooks to order, so this changes nothing.'
                      : `Holding a kitchen back costs nothing, because the customer was already waiting on the slowest one, and the goods arrive fresher. ${fixedScheduleCount} vendor${fixedScheduleCount > 1 ? 's' : ''} here cannot be scheduled.`}
                  </Typography.Text>
                </span>
              </div>
            </Card>

            <Card title="Plans" size="small" style={{ marginTop: 16 }}>
              {basket.orders.length === 0 && (
                <Alert type="info" title="Pick at least one vendor." showIcon />
              )}

              {scored.map((entry, index) => (
                <button
                  key={entry.plan.strategy}
                  type="button"
                  className={`plan-row${entry.plan.strategy === shown?.plan.strategy ? ' is-active' : ''}`}
                  onClick={() => setChosen(entry.plan.strategy)}
                >
                  <span className="plan-row-head">
                    <strong>{entry.plan.strategy}</strong>
                    {tied.has(entry.plan.strategy) &&
                      (tied.size > 1 ? (
                        index === 0 && <Tag color="gold">too close to call</Tag>
                      ) : (
                        <Tag color="green">best</Tag>
                      ))}
                    <span className="plan-row-total">{riyal(entry.total)}</span>
                  </span>
                  <Typography.Text type="secondary" className="hint">
                    {STRATEGY_BLURB[entry.plan.strategy]}
                  </Typography.Text>
                  <span className="plan-row-meta">
                    <span>arrives {minutes(entry.plan.completeAt - basket.placedAt)}</span>
                    <span>courier {(entry.plan.courierSeconds / 60).toFixed(0)} min</span>
                    <span>idle {(entry.plan.idleSeconds / 60).toFixed(0)} min</span>
                  </span>
                </button>
              ))}

              {rejected.map((attempt) =>
                isPlan(attempt) ? null : (
                  <Alert
                    key={attempt.strategy}
                    type="warning"
                    style={{ marginTop: 8 }}
                    title={`${attempt.strategy}: ${attempt.reason}`}
                  />
                ),
              )}
            </Card>
          </Col>

          <Col xs={24} lg={15}>
            <Card
              size="small"
              title={shown ? `${shown.plan.strategy} plan` : 'Plan'}
              extra={
                shown?.plan.handovers.length ? (
                  <Typography.Text type="secondary" className="hint">
                    dashed = converging to hand over
                  </Typography.Text>
                ) : null
              }
            >
              <PlanMap basket={basket} couriers={COURIERS} plan={shown?.plan ?? null} />

              {shown && (
                <Row gutter={16} style={{ marginTop: 12 }}>
                  <Col xs={12} sm={6}>
                    <Statistic title="Total" value={shown.total} precision={2} suffix="QAR" />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic title="Operating" value={shown.operating} precision={2} suffix="QAR" />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic title="Freshness lost" value={shown.freshness} precision={2} suffix="QAR" />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic title="Customer wait" value={shown.latency} precision={2} suffix="QAR" />
                  </Col>
                </Row>
              )}

              {shown && (
                <div className="ages">
                  {basket.orders.map((order) => (
                    <span key={order.vendorId} className="age">
                      <span className="age-label">{order.vendor.label}</span>
                      <strong>
                        {(shown.plan.carriageSeconds[order.vendorId] / 60).toFixed(0)} min old
                      </strong>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {order.vendor.schedulable ? 'cooked to meet the courier' : 'fixed schedule'}
                      </Typography.Text>
                    </span>
                  ))}
                </div>
              )}
            </Card>

            {shares && (
              <Card size="small" title="Who pays for the delivery" style={{ marginTop: 16 }}>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="vendorId"
                  scroll={{ x: 520 }}
                  dataSource={basket.orders.map((order) => ({
                    vendorId: order.vendorId,
                    label: order.vendor.label,
                    alone: shares.alone[order.vendorId],
                    fair: shares.fair[order.vendorId],
                    equal: shares.equal[order.vendorId],
                    byValue: shares.byValue[order.vendorId],
                  }))}
                  columns={[
                    { title: 'Vendor', dataIndex: 'label' },
                    { title: 'Alone', dataIndex: 'alone', render: (v: number) => riyal(v) },
                    {
                      title: 'Fair share',
                      dataIndex: 'fair',
                      render: (v: number) => <strong>{riyal(v)}</strong>,
                    },
                    {
                      title: 'Split evenly',
                      dataIndex: 'equal',
                      render: (value: number, row) => (
                        <span className={value > row.alone ? 'over-alone' : undefined}>
                          {riyal(value)}
                        </span>
                      ),
                    },
                    {
                      title: 'By basket value',
                      dataIndex: 'byValue',
                      render: (value: number, row) => (
                        <span className={value > row.alone ? 'over-alone' : undefined}>
                          {riyal(value)}
                        </span>
                      ),
                    },
                  ]}
                />
                <Typography.Paragraph type="secondary" className="hint" style={{ marginTop: 10 }}>
                  Fair share bills each vendor its average marginal contribution, so
                  whoever dragged the courier off the route pays for the detour they
                  caused. Figures marked in red exceed what that vendor would have paid
                  delivering alone — it is subsidising the others and can prove it, which
                  is how a naive split falls apart once vendors compare notes.
                </Typography.Paragraph>
              </Card>
            )}
          </Col>
        </Row>
      </Layout.Content>
    </Layout>
  )
}
